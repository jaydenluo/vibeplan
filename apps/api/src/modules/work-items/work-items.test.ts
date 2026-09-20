import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { users } from '../../db/schema.js';
import { AccessService } from '../access/service.js';
import { WorkItemService, WorkItemConflictError } from './service.js';

describe('work item service', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('creates work items, records events, and rejects stale updates', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `work-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Work Org ${suffix}`, `work-org-${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core', `core-${suffix}`);
    const project = await access.createProject(user.id, team.id, 'Core Project', `core-project-${suffix}`, 'https://example.com/core.git');
    const workItems = new WorkItemService(db);

    const item = await workItems.create(user.id, project.id, {
      title: 'Add login',
      description: 'Implement email login',
      type: 'feature',
      priority: 'P1',
      acceptanceCriteria: ['User can sign in'],
    });
    expect(item.status).toBe('backlog');

    const ready = await workItems.update(user.id, item.id, item.version, { status: 'ready' });
    expect(ready.version).toBe(2);
    await expect(workItems.update(user.id, item.id, item.version, { status: 'in_progress' })).rejects.toBeInstanceOf(WorkItemConflictError);

    const events = await workItems.events(project.id);
    expect(events.map((event) => event.action)).toEqual(['created', 'updated']);
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });
});
