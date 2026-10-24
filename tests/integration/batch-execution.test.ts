import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { db, sqlClient } from '../../apps/api/src/db/client.js';
import { migrate } from '../../apps/api/src/db/migrate.js';
import { users } from '../../apps/api/src/db/schema.js';
import { AccessService } from '../../apps/api/src/modules/access/service.js';
import { WorkItemService } from '../../apps/api/src/modules/work-items/service.js';
import { makePlan, type BatchTask } from '../../apps/cli/src/batch/plan.js';
import { executePlan, type BatchClient } from '../../apps/cli/src/batch/runner.js';
import { runCheck } from '../../apps/cli/src/batch/executor.js';

beforeAll(() => migrate());
it('executes a dependency chain against the actual service and records report, criterion review and acceptance', async () => {
  const [actor] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, passwordHash: 'test', displayName: 'Batch reviewer' }).returning();
  const access = new AccessService(db), org = await access.createOrganization(actor.id, 'Batch test'), team = await access.createTeam(actor.id, org.id, 'Core'), project = await access.createProject(actor.id, team.id, 'Batch');
  const root = mkdtempSync(join(tmpdir(), 'vibe-batch-service-'));
  try {
    const service = new WorkItemService(db);
    const create = (title: string, dependsOn: string[]) => service.create(actor.id, project.id, { title, description: 'Test actual lifecycle', type: 'feature', priority: 'P2', status: 'backlog', planMarkdown: '# Implement\nVerify actual lifecycle.', acceptanceCriteria: ['Lifecycle works'], dueDate: null, estimate: 1, dependsOn });
    const first = await create('First', []), second = await create('Second', [first.id]);
    const plan = makePlan({ projectId: project.id, actorId: actor.id, server: 'http://localhost:4000' }, [second, first] as BatchTask[], [], [[process.execPath, '-e', 'console.log("actual check passed")']]);
    const client: BatchClient = {
      workItem: async (id) => await service.get(actor.id, id) as BatchTask,
      permissions: (id) => service.permissions(actor.id, id),
      update: (id, v, patch) => service.update(actor.id, id, v, patch) as Promise<BatchTask>,
      report: (id, v, input) => service.report(actor.id, id, v, input as never) as Promise<BatchTask>,
      review: (id, v, c, reason) => service.updateAcceptanceItem(actor.id, id, v, c, { status: 'passed', comment: reason, evidence: [] }) as Promise<BatchTask>,
      accept: (id, v, comment) => service.accept(actor.id, id, v, { decision: 'approved', comment }) as Promise<BatchTask>,
    };
    const order: string[] = [];
    const state = await executePlan(plan, undefined, true, root, root, { client, check: runCheck, codex: async ({ prompt, mode }) => {
      const t = JSON.parse(prompt.match(/TASK:\n([^\n]+)/)![1]) as BatchTask;
      if (mode === 'implement') order.push(t.id);
      return { summary: 'Lifecycle verified', outcome: 'success', changedFiles: [], criteria: [{ id: t.acceptanceItems[0].id, passed: true, reason: 'Actual isolated lifecycle exercised' }], remainingIssues: [] };
    }, save: () => {}, log: () => {} });
    expect(order).toEqual([first.id, second.id]); expect(state.outcome).toBe('complete');
    expect((await service.get(actor.id, second.id)).status).toBe('done');
    for (const task of [first, second]) {
      const history = await service.history(actor.id, task.id), report = history.find((e) => e.action === 'report')!;
      expect(report.payload.tests).toMatchObject([{ exitCode: 0, outcome: 'passed' }]);
      expect(history.some((e) => e.action === 'acceptance_item_reviewed')).toBe(true);
      expect(history.filter((e) => e.action === 'acceptance')).toHaveLength(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    await sqlClient`delete from organizations where id=${org.id}`;
    await sqlClient`delete from users where id=${actor.id}`;
  }
});
