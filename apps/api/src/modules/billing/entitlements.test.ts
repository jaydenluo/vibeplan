import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { organizationMemberships, organizationSubscriptions, organizations, projects, teams, users } from '../../db/schema.js';
import { EntitlementService } from './entitlements.js';

describe('EntitlementService', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('aggregates the free project allowance across an owner\'s free organizations', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `billing-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [firstOrganization] = await db.insert(organizations).values({ name: 'First', slug: `first-${suffix}` }).returning();
    const [secondOrganization] = await db.insert(organizations).values({ name: 'Second', slug: `second-${suffix}` }).returning();
    await db.insert(organizationMemberships).values([
      { userId: owner.id, organizationId: firstOrganization.id, role: 'owner' },
      { userId: owner.id, organizationId: secondOrganization.id, role: 'owner' },
    ]);
    const [firstTeam] = await db.insert(teams).values({ organizationId: firstOrganization.id, name: 'First', slug: `first-team-${suffix}` }).returning();
    const [secondTeam] = await db.insert(teams).values({ organizationId: secondOrganization.id, name: 'Second', slug: `second-team-${suffix}` }).returning();
    await db.insert(projects).values([
      ...Array.from({ length: 9 }, (_, index) => ({ teamId: firstTeam.id, name: `Project ${index}`, slug: `first-project-${index}-${suffix}` })),
      { teamId: secondTeam.id, name: 'Project 10', slug: `second-project-${suffix}` },
    ]);

    const policy = await new EntitlementService(db).getOrganizationPolicy(secondOrganization.id);

    expect(policy.projectUsage).toEqual({ used: 10, limit: 10 });
    expect(policy.canCreateProject).toBe(false);
    await sqlClient`delete from users where id = ${owner.id}`;
  });

  it('keeps free organizations single-member and counts paid organization seats once', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `seat-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [member] = await db.insert(users).values({ email: `seat-member-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Seats', slug: `seats-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });

    const freePolicy = await new EntitlementService(db).getOrganizationPolicy(organization.id);
    expect(freePolicy.canAddMember).toBe(false);

    await db.insert(organizationSubscriptions).values({
      organizationId: organization.id,
      planCode: 'team_10',
      status: 'active',
      amountCents: 48000,
      seatLimit: 10,
      projectLimit: null,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2027-01-01T00:00:00Z'),
      graceEndsAt: new Date('2027-01-08T00:00:00Z'),
      provider: 'manual',
    });
    await db.insert(organizationMemberships).values({ userId: member.id, organizationId: organization.id, role: 'member' });
    const paidPolicy = await new EntitlementService(db).getOrganizationPolicy(organization.id);
    expect(paidPolicy.memberUsage).toEqual({ used: 2, limit: 10 });
    expect(paidPolicy.canAddMember).toBe(true);
    await sqlClient`delete from users where id in (${owner.id}, ${member.id})`;
  });

  it('allows writes in grace and denies them after the grace period', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `expiry-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Expiry', slug: `expiry-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });
    await db.insert(organizationSubscriptions).values({
      organizationId: organization.id,
      planCode: 'team_10',
      status: 'active',
      amountCents: 48000,
      seatLimit: 10,
      projectLimit: null,
      periodStart: new Date('2025-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-01T00:00:00Z'),
      graceEndsAt: new Date('2026-01-08T00:00:00Z'),
      provider: 'manual',
    });

    const inGrace = await new EntitlementService(db, () => new Date('2026-01-04T00:00:00Z')).getOrganizationPolicy(organization.id);
    const expired = await new EntitlementService(db, () => new Date('2026-01-09T00:00:00Z')).getOrganizationPolicy(organization.id);

    expect(inGrace).toMatchObject({ state: 'grace', canWrite: true });
    expect(expired).toMatchObject({ state: 'read_only', canWrite: false });
    await sqlClient`delete from users where id = ${owner.id}`;
  });

  it('keeps a scheduled downgrade as a manual-renewal preference until the paid period ends', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `downgrade-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const extraMembers = await db.insert(users).values(Array.from({ length: 10 }, (_, index) => ({ email: `downgrade-${index}-${suffix}@example.com`, passwordHash: 'test' }))).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Downgrade', slug: `downgrade-${suffix}` }).returning();
    await db.insert(organizationMemberships).values([
      { userId: owner.id, organizationId: organization.id, role: 'owner' },
      ...extraMembers.map((member) => ({ userId: member.id, organizationId: organization.id, role: 'member' })),
    ]);
    await db.insert(organizationSubscriptions).values({
      organizationId: organization.id,
      planCode: 'team_30',
      status: 'active',
      amountCents: 128000,
      seatLimit: 30,
      projectLimit: null,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2027-01-01T00:00:00Z'),
      graceEndsAt: new Date('2027-01-08T00:00:00Z'),
      scheduledPlanCode: 'team_10',
      scheduledAt: new Date('2027-01-01T00:00:00Z'),
      provider: 'manual',
    });

    const policy = await new EntitlementService(db, () => new Date('2026-06-01T00:00:00Z')).getOrganizationPolicy(organization.id);

    expect(policy).toMatchObject({ planCode: 'team_30', memberUsage: { used: 11, limit: 30 }, canWrite: true, canAddMember: true, denialCode: null });
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${owner.id}`;
    for (const member of extraMembers) await sqlClient`delete from users where id = ${member.id}`;
  });
});
