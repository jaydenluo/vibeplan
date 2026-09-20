import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { db, sqlClient } from './client.js';
import {
  organizations,
  organizationMemberships,
  projects,
  teams,
  teamMemberships,
  users,
} from './schema.js';
import { listProjectsForUser } from '../repositories/projects.js';

describe('database organization scope', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('does not return a project outside the requested organization', async () => {
    const suffix = crypto.randomUUID();
    const [user] = await db.insert(users).values({ email: `scope-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [orgA] = await db.insert(organizations).values({ name: `A-${suffix}`, slug: `a-${suffix}` }).returning();
    const [orgB] = await db.insert(organizations).values({ name: `B-${suffix}`, slug: `b-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: user.id, organizationId: orgA.id, role: 'member' });
    const [teamA] = await db.insert(teams).values({ organizationId: orgA.id, name: 'Frontend', slug: `frontend-${suffix}` }).returning();
    const [teamB] = await db.insert(teams).values({ organizationId: orgB.id, name: 'Backend', slug: `backend-${suffix}` }).returning();
    await db.insert(teamMemberships).values({ userId: user.id, teamId: teamA.id, role: 'member' });
    const [projectA] = await db.insert(projects).values({ teamId: teamA.id, name: 'A project', slug: `a-project-${suffix}`, repositoryUrl: 'ssh://example/a.git' }).returning();
    await db.insert(projects).values({ teamId: teamB.id, name: 'B project', slug: `b-project-${suffix}`, repositoryUrl: 'ssh://example/b.git' });

    const visible = await listProjectsForUser(db, user.id, orgA.id);

    expect(visible.map((project) => project.id)).toEqual([projectA.id]);
    await sqlClient`delete from organizations where id in (${orgA.id}, ${orgB.id})`;
  });
});
