import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { db, sqlClient } from './client.js';
import {
  organizations,
  billingOrders,
  platformAdmins,
  platformAuditLogs,
  organizationSubscriptions,
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

  it('creates one current subscription per organization and keeps provider transactions unique', async () => {
    const suffix = crypto.randomUUID();
    const [user] = await db.insert(users).values({ email: `billing-schema-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: `Billing ${suffix}`, slug: `billing-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: user.id, organizationId: organization.id, role: 'owner' });
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

    await expect(db.insert(organizationSubscriptions).values({
      organizationId: organization.id,
      planCode: 'team_30',
      status: 'active',
      amountCents: 128000,
      seatLimit: 30,
      projectLimit: null,
      periodStart: new Date('2027-01-01T00:00:00Z'),
      periodEnd: new Date('2028-01-01T00:00:00Z'),
      graceEndsAt: new Date('2028-01-08T00:00:00Z'),
      provider: 'manual',
    })).rejects.toThrow();
    await db.insert(billingOrders).values({
      organizationId: organization.id,
      purchaserId: user.id,
      orderNo: `billing-order-${suffix}`,
      planCode: 'team_10',
      amountCents: 48000,
      provider: 'manual',
      providerTransactionId: `transaction-${suffix}`,
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2027-01-01T00:00:00Z'),
    });
    await expect(db.insert(billingOrders).values({
      organizationId: organization.id,
      purchaserId: user.id,
      orderNo: `billing-order-next-${suffix}`,
      planCode: 'team_10',
      amountCents: 48000,
      provider: 'manual',
      providerTransactionId: `transaction-${suffix}`,
      periodStart: new Date('2027-01-01T00:00:00Z'),
      periodEnd: new Date('2028-01-01T00:00:00Z'),
    })).rejects.toThrow();
    await sqlClient`delete from billing_orders where purchaser_id = ${user.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('persists one administrator role per user and chronological audit entries', async () => {
    const suffix = crypto.randomUUID();
    const [user] = await db.insert(users).values({ email: `platform-schema-${suffix}@example.com`, passwordHash: 'test' }).returning();
    await db.insert(platformAdmins).values({ userId: user.id, role: 'super_admin', grantedByUserId: user.id });
    await db.insert(platformAuditLogs).values({ actorId: user.id, action: 'admin.me.read', targetType: 'platform_admin', targetId: user.id, metadata: {} });
    await expect(db.insert(platformAdmins).values({ userId: user.id, role: 'operator', grantedByUserId: user.id })).rejects.toThrow();
    await sqlClient`delete from platform_audit_logs where actor_id = ${user.id}`;
    await sqlClient`delete from platform_admins where user_id = ${user.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });
});
