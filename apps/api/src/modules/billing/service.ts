import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { billingOrders, billingProviderNotifications, organizationMemberships, organizationSubscriptions, type BillingOrderStatus, type BillingPlanCode } from '../../db/schema.js';
import { getBillingPlan } from './catalog.js';
import { EntitlementService } from './entitlements.js';
import { createAlipayProviderFromEnv } from './providers/alipay.js';
import { ManualBillingProvider } from './providers/manual.js';
import { BillingProviderError, type BillingProvider, type PaymentRequest, type VerifiedNotification } from './providers/types.js';

export class BillingError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); this.name = 'BillingError'; }
}

type OrderAction = 'renewal' | 'upgrade' | 'downgrade';
type Order = typeof billingOrders.$inferSelect;
export type BillingOrderView = { id: string; orderNo: string; planCode: BillingPlanCode; amountCents: number; status: BillingOrderStatus; provider: string; paidAt: Date | null; createdAt: Date; closedAt: Date | null; payment?: PaymentRequest | null };

function addYear(date: Date): Date { const result = new Date(date); result.setUTCFullYear(result.getUTCFullYear() + 1); return result; }
function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 86_400_000); }
function isPaidSubscription(subscription: typeof organizationSubscriptions.$inferSelect | undefined, now: Date): boolean { return Boolean(subscription && subscription.status !== 'cancelled' && subscription.status !== 'expired' && now < subscription.graceEndsAt); }
function orderView(order: Order, payment?: PaymentRequest | null): BillingOrderView {
  return { id: order.id, orderNo: order.orderNo, planCode: order.planCode, amountCents: order.amountCents, status: order.status, provider: order.provider, paidAt: order.paidAt, createdAt: order.createdAt, closedAt: order.closedAt, ...(payment === undefined ? {} : { payment }) };
}

export class BillingService {
  readonly entitlements: EntitlementService;
  private readonly provider: BillingProvider;
  private readonly now: () => Date;

  constructor(private readonly database: PostgresJsDatabase, options: { now?: () => Date; provider?: BillingProvider } = {}) {
    this.now = options.now ?? (() => new Date());
    this.entitlements = new EntitlementService(database, this.now);
    this.provider = options.provider ?? this.providerFromEnvironment();
  }

  async getSummary(userId: string, organizationId: string) {
    const role = await this.requireMember(userId, organizationId);
    const policy = await this.entitlements.getOrganizationPolicy(organizationId);
    const [subscription] = await this.database.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1);
    const orders = await this.database.select().from(billingOrders).where(eq(billingOrders.organizationId, organizationId)).orderBy(desc(billingOrders.createdAt)).limit(50);
    return {
      organizationId, role,
      subscription: { planCode: policy.planCode, status: policy.state === 'free' ? 'free' : policy.state === 'read_only' ? 'expired' : policy.state, periodStartedAt: subscription?.periodStart ?? null, periodEndsAt: subscription?.periodEnd ?? null, graceEndsAt: subscription?.graceEndsAt ?? null, scheduledPlanCode: subscription?.scheduledPlanCode ?? null, scheduledEffectiveAt: subscription?.scheduledAt ?? null },
      policy: { canWriteOrganization: policy.canWrite, canCreateProject: policy.canCreateProject, canManageMembers: policy.canAddMember, canManageBilling: role === 'owner', memberUsage: policy.memberUsage.used, memberLimit: policy.memberUsage.limit, projectUsage: policy.projectUsage.used, projectLimit: policy.projectUsage.limit, denialCode: policy.denialCode, denialReason: policy.denialCode ? this.denialMessage(policy.denialCode) : null },
      orders: orders.map((order) => orderView(order)),
      payment: { provider: this.provider.name, available: this.paymentAvailable(), testMode: this.provider.name === 'manual' && process.env.NODE_ENV !== 'production' },
    };
  }

  async createOrder(userId: string, organizationId: string, planCode: BillingPlanCode): Promise<BillingOrderView> {
    this.requirePaymentAvailable();
    const created = await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`);
      const service = new BillingService(tx as unknown as PostgresJsDatabase, { now: this.now, provider: this.provider });
      return service.createOrderLocked(userId, organizationId, planCode);
    });
    if (created.view.provider === 'internal') return created.view;
    try {
      return { ...created.view, payment: await this.paymentFor(created.view, organizationId) };
    } catch (error) {
      if (created.created) await this.database.update(billingOrders).set({ status: 'failed', closedAt: this.now(), updatedAt: this.now() }).where(and(eq(billingOrders.id, created.view.id), eq(billingOrders.status, 'pending')));
      throw error;
    }
  }

  private async createOrderLocked(userId: string, organizationId: string, planCode: BillingPlanCode): Promise<{ view: BillingOrderView; created: boolean }> {
    await this.requireOwner(userId, organizationId);
    const targetPlan = getBillingPlan(planCode);
    if (!targetPlan.publiclyPurchasable || targetPlan.annualPriceCents === null) throw new BillingError('BILLING_PLAN_NOT_PURCHASABLE', 'This plan requires contacting VibePlan to activate.');
    const now = this.now();
    const [subscription] = await this.database.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1);
    const currentPlan = getBillingPlan(subscription?.planCode ?? 'free');
    const active = isPaidSubscription(subscription, now);
    const isDowngrade = active && currentPlan.annualPriceCents !== null && targetPlan.annualPriceCents < currentPlan.annualPriceCents;
    if (isDowngrade) return { view: await this.scheduleDowngrade(userId, organizationId, planCode, targetPlan, subscription!, now), created: true };
    const action: OrderAction = active && subscription && planCode !== subscription.planCode ? 'upgrade' : 'renewal';
    const periodStart = action === 'renewal' && active && subscription ? subscription.periodEnd : now;
    const periodEnd = addYear(periodStart);
    const amountCents = action === 'upgrade' && subscription ? this.upgradeAmount(targetPlan.annualPriceCents, currentPlan.annualPriceCents ?? 0, subscription.periodStart, subscription.periodEnd, now) : targetPlan.annualPriceCents;
    const existingPending = await this.database.select().from(billingOrders).where(and(eq(billingOrders.organizationId, organizationId), eq(billingOrders.status, 'pending'))).orderBy(desc(billingOrders.createdAt)).limit(1);
    if (existingPending[0]) {
      if (existingPending[0].provider === 'manual' && this.provider.name === 'alipay') {
        await this.database.update(billingOrders).set({ status: 'closed', closedAt: now, updatedAt: now }).where(eq(billingOrders.id, existingPending[0].id));
      } else {
        if (existingPending[0].planCode !== planCode) throw new BillingError('BILLING_PENDING_ORDER_EXISTS', 'Finish the existing unpaid order before choosing another plan.', 409);
        if (existingPending[0].provider !== this.provider.name) throw new BillingError('PAYMENT_PROVIDER_MISMATCH', 'The unpaid order uses another payment provider.', 409);
        return { view: orderView(existingPending[0]), created: false };
      }
    }
    const [order] = await this.database.insert(billingOrders).values({ organizationId, purchaserId: userId, orderNo: this.orderNumber(), planCode, amountCents, status: 'pending', provider: this.provider.name, periodStart, periodEnd, planSnapshot: { ...targetPlan, action, creditedCents: targetPlan.annualPriceCents - amountCents } }).returning();
    return { view: orderView(order), created: true };
  }

  async getOrder(userId: string, organizationId: string, orderId: string): Promise<BillingOrderView> {
    await this.requireMember(userId, organizationId);
    const [order] = await this.database.select().from(billingOrders).where(and(eq(billingOrders.id, orderId), eq(billingOrders.organizationId, organizationId))).limit(1);
    if (!order) throw new BillingError('BILLING_ORDER_NOT_FOUND', 'Billing order does not exist.', 404);
    return orderView(order);
  }

  async resumePayment(userId: string, organizationId: string, orderId: string): Promise<BillingOrderView> {
    await this.requireOwner(userId, organizationId);
    this.requirePaymentAvailable();
    const order = await this.getOrder(userId, organizationId, orderId);
    if (order.status !== 'pending') throw new BillingError('BILLING_ORDER_NOT_PAYABLE', 'This order is no longer payable.', 409);
    if (order.provider !== this.provider.name) throw new BillingError('PAYMENT_PROVIDER_MISMATCH', 'This order uses another payment provider.', 409);
    return { ...order, payment: await this.paymentFor(order, organizationId) };
  }

  private paymentFor(order: BillingOrderView, organizationId: string): Promise<PaymentRequest> {
    return this.provider.createPayment({ orderNo: order.orderNo, subject: `VibePlan ${getBillingPlan(order.planCode).name} annual subscription`, amountCents: order.amountCents, notifyUrl: this.paymentUrl('ALIPAY_NOTIFY_URL'), returnUrl: this.paymentUrl('ALIPAY_RETURN_URL', organizationId) });
  }

  async confirmManualOrder(userId: string, organizationId: string, orderId: string): Promise<BillingOrderView> {
    if (process.env.NODE_ENV === 'production') throw new BillingError('PAYMENT_PROVIDER_NOT_AVAILABLE', 'Manual payment confirmation is disabled in production.', 403);
    await this.requireOwner(userId, organizationId);
    const [order] = await this.database.select().from(billingOrders).where(and(eq(billingOrders.id, orderId), eq(billingOrders.organizationId, organizationId))).limit(1);
    if (!order) throw new BillingError('BILLING_ORDER_NOT_FOUND', 'Billing order does not exist.', 404);
    if (order.provider !== 'manual') throw new BillingError('PAYMENT_PROVIDER_MISMATCH', 'This order is not a manual payment order.');
    return this.confirmVerifiedNotification('manual', { orderNo: order.orderNo, providerTransactionId: `manual-${order.orderNo}`, amountCents: order.amountCents, tradeStatus: 'TRADE_SUCCESS', notificationId: `manual-${order.id}` }, { source: 'local_confirmation' });
  }

  async confirmAlipayNotification(payload: Record<string, string>): Promise<void> {
    if (this.provider.name !== 'alipay') throw new BillingError('PAYMENT_PROVIDER_NOT_AVAILABLE', 'Alipay is not configured.', 503);
    const verified = this.provider.verifyNotification(payload);
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(verified.tradeStatus)) await this.confirmVerifiedNotification('alipay', verified, this.redactedPayload(payload));
  }

  private async scheduleDowngrade(userId: string, organizationId: string, planCode: BillingPlanCode, targetPlan: ReturnType<typeof getBillingPlan>, subscription: typeof organizationSubscriptions.$inferSelect, now: Date): Promise<BillingOrderView> {
    await this.database.update(organizationSubscriptions).set({ scheduledPlanCode: planCode, scheduledAt: subscription.periodEnd, updatedAt: now }).where(eq(organizationSubscriptions.organizationId, organizationId));
    const [order] = await this.database.insert(billingOrders).values({ organizationId, purchaserId: userId, orderNo: this.orderNumber(), planCode, amountCents: 0, status: 'scheduled', provider: 'internal', periodStart: subscription.periodEnd, periodEnd: addYear(subscription.periodEnd), planSnapshot: { ...targetPlan, action: 'downgrade' } }).returning();
    return orderView(order);
  }

  private async confirmVerifiedNotification(provider: string, notification: VerifiedNotification, metadata: Record<string, unknown>): Promise<BillingOrderView> {
    return this.database.transaction(async (tx) => {
      // Serialize all callbacks for one order before checking its status.
      await tx.execute(sql`select id from billing_orders where order_no=${notification.orderNo} for update`);
      const [order] = await tx.select().from(billingOrders).where(eq(billingOrders.orderNo, notification.orderNo)).limit(1);
      if (!order) throw new BillingError('BILLING_ORDER_NOT_FOUND', 'Payment order does not exist.', 404);
      if (order.provider !== provider || order.amountCents !== notification.amountCents) throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'Payment notification does not match the pending order.');
      if (order.status === 'paid') return orderView(order);
      if (order.status !== 'pending') throw new BillingError('BILLING_ORDER_NOT_PAYABLE', 'This billing order is no longer payable.', 409);
      const [duplicateTransaction] = await tx.select({ id: billingOrders.id }).from(billingOrders)
        .where(and(eq(billingOrders.provider, provider), eq(billingOrders.providerTransactionId, notification.providerTransactionId), sql`${billingOrders.id} <> ${order.id}`)).limit(1);
      if (duplicateTransaction) throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'This provider transaction is already attached to another order.');
      const notificationId = notification.notificationId || notification.providerTransactionId;
      const [recorded] = await tx.insert(billingProviderNotifications).values({ billingOrderId: order.id, provider, notificationId, providerTransactionId: notification.providerTransactionId, payload: metadata, verificationResult: 'verified', verifiedAt: this.now(), processedAt: this.now() }).onConflictDoNothing().returning({ id: billingProviderNotifications.id });
      if (!recorded) {
        const [existingNotification] = await tx.select({ billingOrderId: billingProviderNotifications.billingOrderId, providerTransactionId: billingProviderNotifications.providerTransactionId })
          .from(billingProviderNotifications)
          .where(and(eq(billingProviderNotifications.provider, provider), eq(billingProviderNotifications.notificationId, notificationId)))
          .limit(1);
        if (!existingNotification || existingNotification.billingOrderId !== order.id || existingNotification.providerTransactionId !== notification.providerTransactionId) {
          throw new BillingProviderError('PAYMENT_VERIFICATION_FAILED', 'This provider notification is already attached to another payment.');
        }
        const [current] = await tx.select().from(billingOrders).where(eq(billingOrders.id, order.id)).limit(1);
        return orderView(current ?? order);
      }
      const paidAt = this.now();
      const [paidOrder] = await tx.update(billingOrders).set({ status: 'paid', providerTransactionId: notification.providerTransactionId, paidAt, updatedAt: paidAt }).where(eq(billingOrders.id, order.id)).returning();
      const plan = getBillingPlan(paidOrder.planCode);
      const [current] = await tx.select().from(organizationSubscriptions).where(eq(organizationSubscriptions.organizationId, paidOrder.organizationId)).limit(1);
      const values = { planCode: plan.code, status: 'active' as const, amountCents: plan.annualPriceCents ?? paidOrder.amountCents, seatLimit: plan.seatLimit, projectLimit: plan.projectLimit, periodStart: paidOrder.periodStart, periodEnd: paidOrder.periodEnd, graceEndsAt: addDays(paidOrder.periodEnd, 7), scheduledPlanCode: null, scheduledAt: null, provider, currentOrderReference: paidOrder.orderNo, updatedAt: paidAt };
      if (current) await tx.update(organizationSubscriptions).set(values).where(eq(organizationSubscriptions.id, current.id));
      else await tx.insert(organizationSubscriptions).values({ ...values, organizationId: paidOrder.organizationId });
      return orderView(paidOrder);
    });
  }

  private providerFromEnvironment(): BillingProvider {
    const provider = process.env.BILLING_PROVIDER ?? (process.env.NODE_ENV === 'production' ? 'alipay' : 'manual');
    if (provider === 'manual') return new ManualBillingProvider();
    if (provider === 'alipay') {
      try { return createAlipayProviderFromEnv(); } catch { /* Billing remains readable while credentials are being configured. */ }
    }
    return { name: 'unavailable', createPayment: async () => { throw new BillingError('PAYMENT_CONFIGURATION_INVALID', 'Alipay credentials are not configured.', 503); }, verifyNotification: () => { throw new BillingError('PAYMENT_CONFIGURATION_INVALID', 'Alipay credentials are not configured.', 503); } };
  }
  private paymentAvailable(): boolean {
    if (this.provider.name === 'unavailable' || (this.provider.name === 'manual' && process.env.NODE_ENV === 'production')) return false;
    if (this.provider.name === 'alipay') {
      try { this.paymentUrl('ALIPAY_NOTIFY_URL'); this.paymentUrl('ALIPAY_RETURN_URL'); } catch { return false; }
    }
    return true;
  }
  private requirePaymentAvailable(): void {
    if (!this.paymentAvailable()) throw new BillingError('PAYMENT_PROVIDER_NOT_AVAILABLE', 'Payments are not configured. Please contact the administrator.', 503);
  }
  private paymentUrl(variable: 'ALIPAY_NOTIFY_URL' | 'ALIPAY_RETURN_URL', organizationId?: string): string {
    const value = process.env[variable];
    if (value) {
      const url = new URL(value);
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new BillingError('PAYMENT_CONFIGURATION_INVALID', `${variable} must use HTTPS.`, 503);
      return variable === 'ALIPAY_RETURN_URL' && organizationId ? value.replaceAll('ORGANIZATION_ID', encodeURIComponent(organizationId)) : value;
    }
    if (this.provider.name === 'manual') return 'http://localhost/manual-payment';
    throw new BillingError('PAYMENT_CONFIGURATION_INVALID', `${variable} must be configured for Alipay.`, 503);
  }
  private async requireMember(userId: string, organizationId: string) { const [membership] = await this.database.select({ role: organizationMemberships.role }).from(organizationMemberships).where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId))).limit(1); if (!membership) throw new BillingError('BILLING_ORGANIZATION_NOT_FOUND', 'Organization does not exist or is not accessible.', 404); return membership.role as 'owner' | 'admin' | 'member'; }
  private async requireOwner(userId: string, organizationId: string) { if (await this.requireMember(userId, organizationId) !== 'owner') throw new BillingError('BILLING_OWNER_REQUIRED', 'Only the organization owner can manage billing.', 403); }
  private orderNumber(): string { return `VP${this.now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`; }
  private upgradeAmount(targetPrice: number, currentPrice: number, periodStart: Date, periodEnd: Date, now: Date): number { const duration = Math.max(1, periodEnd.getTime() - periodStart.getTime()); return Math.max(0, targetPrice - Math.floor(currentPrice * (Math.max(0, periodEnd.getTime() - now.getTime()) / duration))); }
  private denialMessage(code: string): string { return ({ BILLING_ORGANIZATION_READ_ONLY: '订阅已过宽限期，请续费后继续编辑。', BILLING_FREE_PROJECT_LIMIT_REACHED: '免费项目额度已用完，请升级套餐后继续创建项目。', BILLING_FREE_PLAN_MEMBERSHIP_LOCKED: '免费组织仅允许所有者本人使用，请升级套餐后邀请成员。', BILLING_SEAT_LIMIT_EXCEEDED: '组织成员数超过当前套餐上限，请升级套餐或减少成员后继续编辑。' } as Record<string, string>)[code] ?? '当前订阅不允许此操作。'; }
  private redactedPayload(payload: Record<string, string>): Record<string, unknown> { const { sign: _sign, ...safe } = payload; return safe; }
}
