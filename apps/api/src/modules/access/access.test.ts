import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { AccessError, AccessService } from './service.js';
import { users } from '../../db/schema.js';

describe('organization, team, and project access', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('creates a hierarchy and restricts project visibility to team membership', async () => {
    const suffix = randomUUID();
    const [member] = await db.insert(users).values({ email: `member-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [outsider] = await db.insert(users).values({ email: `outsider-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);

    const organization = await access.createOrganization(member.id, `Acme ${suffix}`, `acme-${suffix}`);
    const team = await access.createTeam(member.id, organization.id, 'Frontend', `frontend-${suffix}`);
    const project = await access.createProject(member.id, team.id, 'Dashboard', `dashboard-${suffix}`, 'ssh://example/dashboard.git');

    expect((await access.listProjects(organization.id, member.id)).map((item) => item.id)).toEqual([project.id]);
    expect((await access.listProjects(organization.id, outsider.id)).map((item) => item.id)).toEqual([]);
    await expect(access.createTeam(outsider.id, organization.id, 'Nope', `nope-${suffix}`)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await sqlClient`delete from users where id in (${member.id}, ${outsider.id})`;
  });

  it('does not allow an organization member to create a project in another team', async () => {
    const suffix = randomUUID();
    const [member] = await db.insert(users).values({ email: `member2-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(member.id, `Acme 2 ${suffix}`, `acme-2-${suffix}`);
    const team = await access.createTeam(member.id, organization.id, 'Backend', `backend-${suffix}`);
    const [otherUser] = await db.insert(users).values({ email: `other-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const otherOrg = await access.createOrganization(otherUser.id, `Other ${suffix}`, `other-${suffix}`);
    const otherTeam = await access.createTeam(otherUser.id, otherOrg.id, 'Other Team', `other-team-${suffix}`);

    await expect(access.createProject(member.id, otherTeam.id, 'Forbidden', `forbidden-${suffix}`, 'ssh://example/forbidden.git')).rejects.toBeInstanceOf(AccessError);
    await sqlClient`delete from users where id in (${member.id}, ${otherUser.id})`;
    expect(team.organizationId).toBe(organization.id);
  });
});
