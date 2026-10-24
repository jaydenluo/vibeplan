import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { workItems } from '../../db/schema.js';
import { WorkItemAccessError, WorkItemConflictError, WorkItemService } from './service.js';
import type { ProjectEventHub } from './events.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export class MutationStore {
  constructor(private readonly database: PostgresJsDatabase, private readonly hub?: ProjectEventHub) {}

  async execute<T>(actorId: string, mutationId: string, request: unknown, target: { projectId?: string; taskId?: string; reviewer?: boolean }, operation: (service: WorkItemService) => Promise<T>): Promise<T> {
    const hash = createHash('sha256').update(canonical(request)).digest('hex');
    const committed = await this.database.transaction(async (tx) => {
      // Serialize the actor's operation ID first, including concurrent creates.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actorId + ':' + mutationId}))`);
      const [cached] = await tx.execute(sql`select project_id, request_hash, result from task_mutations where actor_id=${actorId} and mutation_id=${mutationId}`);
      const [task] = target.taskId ? await tx.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, target.taskId)) : [];
      const projectId = target.projectId ?? task?.projectId ?? (cached ? String(cached.project_id) : undefined);
      if (!projectId) throw new WorkItemAccessError('Work item does not exist.');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const service = new WorkItemService(tx as unknown as PostgresJsDatabase);
      // Replay never restores access that has since been revoked.
      await service.assertMutationAccess(actorId, projectId, target.reviewer);
      if (cached) {
        if (cached.request_hash !== hash) throw new WorkItemConflictError('Mutation ID already belongs to a different request.');
        return { projectId, result: cached.result as T, replay: true };
      }
      const result = JSON.parse(JSON.stringify(await operation(service))) as T;
      await tx.execute(sql`insert into task_mutations(actor_id, mutation_id, project_id, request_hash, result) values(${actorId}, ${mutationId}, ${projectId}, ${hash}, ${JSON.stringify(result)}::jsonb)`);
      return { projectId, result, replay: false };
    });
    if (!committed.replay) this.hub?.publish({ projectId: committed.projectId, workItemId: target.taskId ?? '', action: 'updated', payload: {} });
    return committed.result;
  }
}
