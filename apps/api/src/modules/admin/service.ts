import { and, asc, count, desc, eq, gt, gte, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { billingOrders, organizationMemberships, organizations, organizationSubscriptions, platformAdmins, platformAuditLogs, projects, teams, users, type PlatformAdminRole } from '../../db/schema.js';

export class PlatformAdminError extends Error {
  constructor(public readonly code: 'PLATFORM_ADMIN_REQUIRED' | 'PLATFORM_SUPER_ADMIN_REQUIRED' | 'PLATFORM_ADMIN_TARGET_NOT_FOUND' | 'PLATFORM_ADMIN_PROTECTED', message: string, public readonly statusCode = 403) {
    super(message);
    this.name = 'PlatformAdminError';
  }
}

type PageInput = { q?: string; cursor?: string; limit?: number };
type Role = PlatformAdminRole;

function normalizedEmails(values: string[]): Set<string> { return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean)); }
function parseBootstrap(): string[] { return (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(','); }
function clamp(limit = 25): number { return Math.min(100, Math.max(1, limit)); }
function organizationSubscriptionState(subscription: { planCode: string | null; subscriptionStatus: string | null; periodEnd: Date | null; graceEndsAt: Date | null }, now: Date): 'free' | 'active' | 'grace' | 'read_only' {
  if (!subscription.planCode) return 'free';
  if (subscription.subscriptionStatus === 'cancelled' || subscription.subscriptionStatus === 'expired') return 'read_only';
  if (subscription.periodEnd && now < subscription.periodEnd) return 'active';
  if (subscription.graceEndsAt && now < subscription.graceEndsAt) return 'grace';
  return 'read_only';
}

export class PlatformAdminService {
  private readonly bootstrapEmails: Set<string>;

  constructor(private readonly database: PostgresJsDatabase, options: { bootstrapEmails?: string[] } = {}) {
    this.bootstrapEmails = normalizedEmails(options.bootstrapEmails ?? parseBootstrap());
  }

  async getMe(userId: string) {
    const identity = await this.requireAdmin(userId);
    await this.audit(userId, 'admin.me.read', 'platform_admin', userId, {});
    return { userId, email: identity.email, role: identity.role };
  }

  async overview(userId: string) {
    await this.requireAdmin(userId);
    const [[userTotal], [organizationTotal], [activeSubscriptions], [pendingOrders], [revenue]] = await Promise.all([
      this.database.select({ value: count() }).from(users),
      this.database.select({ value: count() }).from(organizations),
      this.database.select({ value: count() }).from(organizationSubscriptions).where(and(eq(organizationSubscriptions.status, 'active'), gt(organizationSubscriptions.periodEnd, new Date()))),
      this.database.select({ value: count() }).from(billingOrders).where(eq(billingOrders.status, 'pending')),
      this.database.select({ value: sql<number>`coalesce(sum(${billingOrders.amountCents}), 0)` }).from(billingOrders).where(and(eq(billingOrders.status, 'paid'), gt(billingOrders.paidAt, new Date(Date.now() - 30 * 86_400_000)))),
    ]);
    await this.audit(userId, 'admin.overview.read', 'platform', null, {});
    return { userCount: Number(userTotal.value), organizationCount: Number(organizationTotal.value), activeSubscriptionCount: Number(activeSubscriptions.value), pendingOrderCount: Number(pendingOrders.value), revenue30dCents: Number(revenue.value) };
  }

  async listUsers(userId: string, input: PageInput = {}) {
    await this.requireAdmin(userId);
    const limit = clamp(input.limit);
    const filters = [input.cursor ? gt(users.id, input.cursor) : undefined, input.q ? or(ilike(users.email, `%${input.q}%`), ilike(users.displayName, `%${input.q}%`)) : undefined].filter(Boolean);
    const rows = await this.database.select({ id: users.id, email: users.email, displayName: users.displayName, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, role: platformAdmins.role, revokedAt: platformAdmins.revokedAt, organizationCount: sql<number>`(select count(*) from organization_memberships om where om.user_id = ${users.id})` })
      .from(users).leftJoin(platformAdmins, eq(platformAdmins.userId, users.id)).where(filters.length ? and(...filters) : undefined).orderBy(asc(users.id)).limit(limit + 1);
    const items = rows.slice(0, limit).map((row) => ({ id: row.id, email: row.email, displayName: row.displayName, emailVerifiedAt: row.emailVerifiedAt, createdAt: row.createdAt, organizationCount: Number(row.organizationCount), role: row.revokedAt ? null : row.role }));
    await this.audit(userId, 'admin.users.list', 'user', null, { q: input.q ?? null, count: items.length });
    return { items, nextCursor: rows.length > limit ? items.at(-1)?.id ?? null : null };
  }

  async listOrganizations(userId: string, input: PageInput & { planCode?: string; state?: string } = {}) {
    await this.requireAdmin(userId);
    const limit = clamp(input.limit);
    const now = new Date();
    const usableSubscription = or(eq(organizationSubscriptions.status, 'active'), eq(organizationSubscriptions.status, 'grace'), eq(organizationSubscriptions.status, 'manual'));
    const stateFilter = input.state === 'free' ? isNull(organizationSubscriptions.organizationId)
      : input.state === 'active' ? and(isNotNull(organizationSubscriptions.organizationId), usableSubscription, gt(organizationSubscriptions.periodEnd, now))
        : input.state === 'grace' ? and(isNotNull(organizationSubscriptions.organizationId), usableSubscription, lte(organizationSubscriptions.periodEnd, now), gt(organizationSubscriptions.graceEndsAt, now))
          : input.state === 'read_only' ? or(eq(organizationSubscriptions.status, 'cancelled'), eq(organizationSubscriptions.status, 'expired'), and(isNotNull(organizationSubscriptions.organizationId), usableSubscription, lte(organizationSubscriptions.graceEndsAt, now)))
            : undefined;
    const filters = [input.cursor ? gt(organizations.id, input.cursor) : undefined, input.q ? ilike(organizations.name, `%${input.q}%`) : undefined, input.planCode ? eq(organizationSubscriptions.planCode, input.planCode as never) : undefined, stateFilter].filter(Boolean);
    const rows = await this.database.select({ id: organizations.id, name: organizations.name, createdAt: organizations.createdAt, ownerEmail: users.email, planCode: organizationSubscriptions.planCode, subscriptionStatus: organizationSubscriptions.status, periodEnd: organizationSubscriptions.periodEnd, graceEndsAt: organizationSubscriptions.graceEndsAt, memberCount: sql<number>`(select count(*) from organization_memberships om where om.organization_id = ${organizations.id})`, projectCount: sql<number>`(select count(*) from projects p join teams t on t.id = p.team_id where t.organization_id = ${organizations.id})` })
      .from(organizations).innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, organizations.id), eq(organizationMemberships.role, 'owner'))).innerJoin(users, eq(users.id, organizationMemberships.userId)).leftJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id)).where(filters.length ? and(...filters) : undefined).orderBy(asc(organizations.id)).limit(limit + 1);
    const items = rows.slice(0, limit).map((row) => ({ ...row, memberCount: Number(row.memberCount), projectCount: Number(row.projectCount), state: organizationSubscriptionState(row, now) }));
    await this.audit(userId, 'admin.organizations.list', 'organization', null, { q: input.q ?? null, count: items.length });
    return { items, nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null };
  }

  async listOrders(userId: string, input: PageInput & { status?: string; planCode?: string; from?: string; to?: string } = {}) {
    await this.requireAdmin(userId);
    const limit = clamp(input.limit);
    const filters = [input.cursor ? gt(billingOrders.id, input.cursor) : undefined, input.q ? or(ilike(billingOrders.orderNo, `%${input.q}%`), ilike(organizations.name, `%${input.q}%`)) : undefined, input.status ? eq(billingOrders.status, input.status as never) : undefined, input.planCode ? eq(billingOrders.planCode, input.planCode as never) : undefined, input.from ? gte(billingOrders.createdAt, new Date(`${input.from}T00:00:00.000Z`)) : undefined, input.to ? lte(billingOrders.createdAt, new Date(`${input.to}T23:59:59.999Z`)) : undefined].filter(Boolean);
    const rows = await this.database.select({ id: billingOrders.id, orderNo: billingOrders.orderNo, amountCents: billingOrders.amountCents, status: billingOrders.status, planCode: billingOrders.planCode, provider: billingOrders.provider, providerTransactionId: billingOrders.providerTransactionId, paidAt: billingOrders.paidAt, createdAt: billingOrders.createdAt, organizationName: organizations.name, purchaserEmail: users.email })
      .from(billingOrders).innerJoin(organizations, eq(organizations.id, billingOrders.organizationId)).innerJoin(users, eq(users.id, billingOrders.purchaserId)).where(filters.length ? and(...filters) : undefined).orderBy(asc(billingOrders.id)).limit(limit + 1);
    const items = rows.slice(0, limit);
    await this.audit(userId, 'admin.orders.list', 'billing_order', null, { q: input.q ?? null, count: items.length });
    return { items, nextCursor: rows.length > limit ? items.at(-1)?.id ?? null : null };
  }

  async listAdmins(userId: string) {
    await this.requireAdmin(userId);
    const rows = await this.database.select({ userId: users.id, email: users.email, displayName: users.displayName, role: platformAdmins.role, revokedAt: platformAdmins.revokedAt, createdAt: platformAdmins.createdAt }).from(platformAdmins).innerJoin(users, eq(users.id, platformAdmins.userId)).orderBy(desc(platformAdmins.createdAt));
    const result = rows.filter((row) => !row.revokedAt).map((row) => ({ ...row, role: this.bootstrapEmails.has(row.email.toLowerCase()) ? 'super_admin' as const : row.role, bootstrap: this.bootstrapEmails.has(row.email.toLowerCase()) }));
    await this.audit(userId, 'admin.admins.list', 'platform_admin', null, { count: result.length });
    return result;
  }

  async grant(actorId: string, email: string, role: Role) {
    await this.requireSuperAdmin(actorId);
    const [target] = await this.database.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
    if (!target) throw new PlatformAdminError('PLATFORM_ADMIN_TARGET_NOT_FOUND', 'The target user must register before receiving platform access.', 404);
    const [record] = await this.database.insert(platformAdmins).values({ userId: target.id, role, grantedByUserId: actorId, revokedAt: null, revokedByUserId: null, updatedAt: new Date() }).onConflictDoUpdate({ target: platformAdmins.userId, set: { role, grantedByUserId: actorId, revokedAt: null, revokedByUserId: null, updatedAt: new Date() } }).returning();
    await this.audit(actorId, 'admin.admin.grant', 'platform_admin', target.id, { role });
    return { userId: target.id, email: target.email, role: record.role };
  }

  async revoke(actorId: string, targetUserId: string) {
    await this.requireSuperAdmin(actorId);
    const [target] = await this.database.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) throw new PlatformAdminError('PLATFORM_ADMIN_TARGET_NOT_FOUND', 'Platform administrator does not exist.', 404);
    if (this.bootstrapEmails.has(target.email.toLowerCase())) throw new PlatformAdminError('PLATFORM_ADMIN_PROTECTED', 'Bootstrap super administrators cannot be revoked from the database.');
    const activeSuperAdmins = await this.effectiveSuperAdminIds();
    if (activeSuperAdmins.has(targetUserId) && activeSuperAdmins.size <= 1) throw new PlatformAdminError('PLATFORM_ADMIN_PROTECTED', 'The last effective super administrator cannot be revoked.');
    const [updated] = await this.database.update(platformAdmins).set({ revokedAt: new Date(), revokedByUserId: actorId, updatedAt: new Date() }).where(and(eq(platformAdmins.userId, targetUserId), isNull(platformAdmins.revokedAt))).returning();
    if (!updated) throw new PlatformAdminError('PLATFORM_ADMIN_TARGET_NOT_FOUND', 'Active platform administrator does not exist.', 404);
    await this.audit(actorId, 'admin.admin.revoke', 'platform_admin', targetUserId, {});
    return { userId: targetUserId, revoked: true };
  }

  private async requireAdmin(userId: string) { const identity = await this.identity(userId); if (!identity) throw new PlatformAdminError('PLATFORM_ADMIN_REQUIRED', 'Platform administrator access is required.'); return identity; }
  private async requireSuperAdmin(userId: string) { const identity = await this.requireAdmin(userId); if (identity.role !== 'super_admin') throw new PlatformAdminError('PLATFORM_SUPER_ADMIN_REQUIRED', 'Super administrator access is required.'); return identity; }
  private async identity(userId: string): Promise<{ email: string; role: Role; bootstrap: boolean } | null> { const [user] = await this.database.select({ email: users.email, role: platformAdmins.role, revokedAt: platformAdmins.revokedAt }).from(users).leftJoin(platformAdmins, eq(platformAdmins.userId, users.id)).where(eq(users.id, userId)).limit(1); if (!user) return null; const bootstrap = this.bootstrapEmails.has(user.email.toLowerCase()); if (bootstrap) { await this.database.insert(platformAdmins).values({ userId, role: 'super_admin', grantedByUserId: userId, revokedAt: null, revokedByUserId: null, updatedAt: new Date() }).onConflictDoUpdate({ target: platformAdmins.userId, set: { role: 'super_admin', revokedAt: null, revokedByUserId: null, updatedAt: new Date() } }); return { email: user.email, role: 'super_admin', bootstrap }; } if (user.role && !user.revokedAt) return { email: user.email, role: user.role, bootstrap: false }; return null; }
  private async effectiveSuperAdminIds() { const rows = await this.database.select({ userId: users.id, email: users.email, role: platformAdmins.role, revokedAt: platformAdmins.revokedAt }).from(users).leftJoin(platformAdmins, eq(platformAdmins.userId, users.id)); return new Set(rows.filter((row) => this.bootstrapEmails.has(row.email.toLowerCase()) || (row.role === 'super_admin' && !row.revokedAt)).map((row) => row.userId)); }
  private async audit(actorId: string, action: string, targetType: string, targetId: string | null, metadata: Record<string, unknown>) { await this.database.insert(platformAuditLogs).values({ actorId, action, targetType, targetId, metadata }); }
}
