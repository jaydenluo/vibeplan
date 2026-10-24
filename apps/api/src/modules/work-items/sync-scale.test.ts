import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { users, workItems } from '../../db/schema.js';
import { AccessService } from '../access/service.js';
import { WorkItemService } from './service.js';
beforeAll(() => migrate());
it('keeps unchanged and single-task delta responses small for a 1000-task project', async () => {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, passwordHash: 'test' }).returning();
  const access = new AccessService(db);
  const org = await access.createOrganization(user.id, 'Scale');
  try {
    const team = await access.createTeam(user.id, org.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Project');
    await db.insert(workItems).values(Array.from({ length: 1000 }, (_, i) => ({ projectId: project.id, reporterId: user.id, title: `Task ${i}`, type: 'feature', status: 'backlog', priority: 'P2' })));
    const service = new WorkItemService(db);
    const snapshot = await service.syncFeed(user.id, project.id);
    const unchanged = await service.syncFeed(user.id, project.id, snapshot.cursor);
    const task = snapshot.items[0];
    await service.update(user.id, task.id, task.version, { title: 'Changed' });
    const delta = await service.syncFeed(user.id, project.id, snapshot.cursor);
    const bytes = (data: unknown) => Buffer.byteLength(JSON.stringify(data));
    expect(snapshot.items).toHaveLength(1000);
    expect(unchanged.changes).toEqual([]);
    expect(delta.changes).toHaveLength(1);
    expect(bytes(unchanged)).toBeLessThan(500);
    expect(bytes(delta)).toBeLessThan(bytes(snapshot) / 100);
    console.log(`Sync scale: snapshot=${bytes(snapshot)}B, unchanged=${bytes(unchanged)}B, single-update=${bytes(delta)}B`);
  } finally { await sqlClient`delete from organizations where id=${org.id}`; await sqlClient`delete from users where id=${user.id}`; }
});
