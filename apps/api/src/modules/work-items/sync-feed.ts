import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export class SyncResetError extends Error {
  constructor() { super('Sync cursor is invalid; fetch a new snapshot.'); }
}

// Called only while the project's write lock is held. The head and tombstone
// commit with the task transaction, so a cursor never skips an uncommitted write.
export async function appendSyncChange(database: PostgresJsDatabase, projectId: string, id: string, action: 'upsert' | 'delete') {
  const [head] = await database.execute(sql`insert into project_sync_heads(project_id, sequence) values(${projectId}, 1)
    on conflict(project_id) do update set sequence=project_sync_heads.sequence+1 returning sequence::text`);
  await database.execute(sql`insert into project_sync_changes(project_id, sequence, work_item_id, action) values(${projectId}, ${String(head.sequence)}::bigint, ${id}, ${action})`);
  const sequence = BigInt(String(head.sequence));
  // Bound durable feed history without invalidating the current snapshot.
  // Compaction shares the project lock and transaction with the mutation.
  if (sequence > 20000n && sequence % 1000n === 0n) {
    const floor = String(sequence - 10000n);
    await database.execute(sql`delete from project_sync_changes where project_id=${projectId} and sequence<=${floor}::bigint`);
    await database.execute(sql`update project_sync_heads set minimum_cursor=${floor}::bigint where project_id=${projectId}`);
  }
  return Number(head.sequence);
}
