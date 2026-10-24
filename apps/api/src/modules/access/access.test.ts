import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { AccessError, AccessService } from './service.js';
import { organizationSubscriptions, teamMemberships, users } from '../../db/schema.js';

describe('organization, team, and project access', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('creates a hierarchy and restricts project visibility to team membership', async () => {
    const suffix = randomUUID();
    const [member] = await db.insert(users).values({ email: `member-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [outsider] = await db.insert(users).values({ email: `outsider-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);

    const organization = await access.createOrganization(member.id, `Acme ${suffix}`);
    const team = await access.createTeam(member.id, organization.id, 'Frontend');
    const project = await access.createProject(member.id, team.id, 'Dashboard', 'ssh://example/dashboard.git');

    expect((await access.listProjects(organization.id, member.id)).map((item) => item.id)).toEqual([project.id]);
    expect(await access.getProject(member.id, project.id)).toMatchObject({
      id: project.id,
      organizationId: organization.id,
    });
    expect((await access.listProjects(organization.id, outsider.id)).map((item) => item.id)).toEqual([]);
    await expect(access.createTeam(outsider.id, organization.id, 'Nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await sqlClient`delete from users where id in (${member.id}, ${outsider.id})`;
  });

  it('does not allow an organization member to create a project in another team', async () => {
    const suffix = randomUUID();
    const [member] = await db.insert(users).values({ email: `member2-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(member.id, `Acme 2 ${suffix}`);
    const team = await access.createTeam(member.id, organization.id, 'Backend');
    const [otherUser] = await db.insert(users).values({ email: `other-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const otherOrg = await access.createOrganization(otherUser.id, `Other ${suffix}`);
    const otherTeam = await access.createTeam(otherUser.id, otherOrg.id, 'Other Team');

    await expect(access.createProject(member.id, otherTeam.id, 'Forbidden', 'ssh://example/forbidden.git')).rejects.toBeInstanceOf(AccessError);
    await sqlClient`delete from users where id in (${member.id}, ${otherUser.id})`;
    expect(team.organizationId).toBe(organization.id);
  });

  it('supports organization invitations and team join request approval', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [invitee] = await db.insert(users).values({ email: `invitee-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(owner.id, `Org ${suffix}`);
    const team = await access.createTeam(owner.id, organization.id, 'Core');
    await db.insert(organizationSubscriptions).values({
      organizationId: organization.id,
      planCode: 'team_10',
      status: 'active',
      amountCents: 48000,
      seatLimit: 10,
      projectLimit: null,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2100-01-01T00:00:00Z'),
      graceEndsAt: new Date('2100-01-08T00:00:00Z'),
      provider: 'manual',
    });

    const invitation = await access.inviteMember(owner.id, organization.id, invitee.email, team.id);
    expect((await access.listPending(invitee.id)).invitations).toHaveLength(1);
    await access.acceptInvitation(invitee.id, invitation.id);
    expect((await access.listTeams(invitee.id, organization.id)).map((item) => item.id)).toContain(team.id);

    const [applicant] = await db.insert(users).values({ email: `applicant-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const request = await access.requestTeamMembership(applicant.id, team.id);
    expect((await access.listTeamJoinRequests(owner.id, team.id)).map((item) => item.id)).toContain(request.id);
    await access.reviewTeamJoinRequest(owner.id, request.id, 'approved');
    expect((await access.listTeams(applicant.id, organization.id)).map((item) => item.id)).toContain(team.id);

    const linkInvitee = await db.insert(users).values({ email: `link-invitee-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const link = await access.createInviteLink(owner.id, organization.id, team.id);
    await access.revokeInviteLink(owner.id, link.token);
    await expect(access.acceptInviteLink(linkInvitee[0].id, link.token)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await sqlClient`delete from users where id in (${owner.id}, ${invitee.id}, ${applicant.id}, ${linkInvitee[0].id})`;
  });

  it('prevents free organizations from inviting or adding another member', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `free-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [invitee] = await db.insert(users).values({ email: `free-invitee-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(owner.id, `Free ${suffix}`);

    await expect(access.inviteMember(owner.id, organization.id, invitee.email)).rejects.toMatchObject({ code: 'BILLING_FREE_PLAN_MEMBERSHIP_LOCKED' });
    await sqlClient`delete from users where id in (${owner.id}, ${invitee.id})`;
  });

  it('generates internal slugs and allows projects without a repository URL', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `slug-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);

    const organization = await access.createOrganization(owner.id, '设计团队');
    const team = await access.createTeam(owner.id, organization.id, '前端');
    const project = await access.createProject(owner.id, team.id, '移动端', undefined);

    expect(organization.slug).toMatch(/^org-[a-f0-9]{8}-[a-f0-9]{8}$/);
    expect(team.slug).toMatch(/^team-[a-f0-9]{8}-[a-f0-9]{8}$/);
    expect(project.slug).toMatch(/^project-[a-f0-9]{8}-[a-f0-9]{8}$/);
    expect(project.repositoryUrl).toBeNull();

    await sqlClient`delete from users where id = ${owner.id}`;
  });

  it('allows team managers to update team and project details', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `edit-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(owner.id, `Edit Org ${suffix}`);
    const team = await access.createTeam(owner.id, organization.id, '旧团队');
    const project = await access.createProject(owner.id, team.id, '旧项目', 'https://example.com/old.git');

    const updatedTeam = await access.updateTeam(owner.id, team.id, '新团队');
    const updatedProject = await access.updateProject(owner.id, project.id, { name: '新项目', repositoryUrl: null });

    expect(updatedTeam.name).toBe('新团队');
    expect(updatedProject).toMatchObject({ name: '新项目', repositoryUrl: null, teamId: team.id });
    await sqlClient`delete from users where id = ${owner.id}`;
  });

  it('lists team details and lets managers change or remove members', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `team-owner-${suffix}@example.com`, passwordHash: 'test', displayName: '团队负责人' }).returning();
    const [member] = await db.insert(users).values({ email: `team-member-${suffix}@example.com`, passwordHash: 'test', displayName: '团队成员' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(owner.id, `Team Org ${suffix}`);
    const team = await access.createTeam(owner.id, organization.id, '协作组');
    await db.insert(teamMemberships).values({ userId: member.id, teamId: team.id, role: 'member' });

    const details = await access.getTeamDetails(owner.id, team.id);
    expect(details).toMatchObject({ canManage: true, team: { id: team.id }, members: expect.arrayContaining([expect.objectContaining({ userId: member.id, role: 'member' })]) });
    await access.updateTeamMember(owner.id, team.id, member.id, 'lead');
    await access.removeTeamMember(owner.id, team.id, member.id);
    expect((await access.getTeamDetails(owner.id, team.id)).members.map((item) => item.userId)).not.toContain(member.id);
    await sqlClient`delete from users where id in (${owner.id}, ${member.id})`;
  });
});
