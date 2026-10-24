import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { organizationMemberships, organizations, organizationSubscriptions, platformAdmins, users } from '../../db/schema.js';
import { PlatformAdminError, PlatformAdminService } from './service.js';

describe('PlatformAdminService', () => {
  beforeAll(async () => { await migrate(); });

  it('treats a configured email as a bootstrap super administrator and audits access', async () => {
    const suffix = randomUUID();
    const email = `bootstrap-${suffix}@example.com`;
    const [user] = await db.insert(users).values({ email, passwordHash: 'test', displayName: 'Bootstrap' }).returning();
    const service = new PlatformAdminService(db, { bootstrapEmails: [email] });

    await expect(service.getMe(user.id)).resolves.toMatchObject({ userId: user.id, email, role: 'super_admin' });
    await expect(service.listUsers(user.id, { limit: 10 })).resolves.toMatchObject({ items: expect.any(Array) });
    await sqlClient`delete from platform_audit_logs where actor_id = ${user.id}`;
    await sqlClient`delete from platform_admins where user_id = ${user.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('allows a persisted operator to read paginated users but not manage roles', async () => {
    const suffix = randomUUID();
    const [superAdmin] = await db.insert(users).values({ email: `super-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [operator] = await db.insert(users).values({ email: `operator-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [target] = await db.insert(users).values({ email: `target-${suffix}@example.com`, passwordHash: 'test' }).returning();
    await db.insert(platformAdmins).values({ userId: operator.id, role: 'operator', grantedByUserId: superAdmin.id });
    const service = new PlatformAdminService(db, { bootstrapEmails: [superAdmin.email] });

    const page = await service.listUsers(operator.id, { q: target.email, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: target.id, email: target.email });
    await expect(service.grant(superAdmin.id, target.email, 'operator')).resolves.toMatchObject({ role: 'operator' });
    await expect(service.grant(operator.id, superAdmin.email, 'operator')).rejects.toBeInstanceOf(PlatformAdminError);
    await sqlClient`delete from platform_audit_logs where actor_id in (${superAdmin.id}, ${operator.id}, ${target.id})`;
    await sqlClient`delete from platform_admins where user_id in (${superAdmin.id}, ${operator.id}, ${target.id})`;
    await sqlClient`delete from users where id in (${superAdmin.id}, ${operator.id}, ${target.id})`;
  });

  it('denies users without a platform role', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `plain-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const service = new PlatformAdminService(db, { bootstrapEmails: [] });

    await expect(service.overview(user.id)).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' });
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('shows cancelled subscriptions as read-only even before their original period ends', async () => {
    const suffix = randomUUID();
    const [admin] = await db.insert(users).values({ email: `admin-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [owner] = await db.insert(users).values({ email: `owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: `Cancelled ${suffix}`, slug: `cancelled-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });
    await db.insert(organizationSubscriptions).values({ organizationId: organization.id, planCode: 'team_10', status: 'cancelled', amountCents: 48000, seatLimit: 10, projectLimit: null, periodStart: new Date('2026-01-01T00:00:00Z'), periodEnd: new Date('2099-01-01T00:00:00Z'), graceEndsAt: new Date('2099-01-08T00:00:00Z'), provider: 'manual' });
    const service = new PlatformAdminService(db, { bootstrapEmails: [admin.email] });

    const page = await service.listOrganizations(admin.id, { q: organization.name });
    expect(page.items).toEqual([expect.objectContaining({ id: organization.id, state: 'read_only' })]);
    await sqlClient`delete from platform_audit_logs where actor_id = ${admin.id}`;
    await sqlClient`delete from platform_admins where user_id = ${admin.id}`;
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id in (${admin.id}, ${owner.id})`;
  });
});
