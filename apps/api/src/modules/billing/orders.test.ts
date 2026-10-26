import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { organizationMemberships, organizations, users } from '../../db/schema.js';
import { ManualBillingProvider } from './providers/manual.js';
import type { BillingProvider } from './providers/types.js';
import { BillingError, BillingService } from './service.js';

describe('BillingService orders', () => {
  beforeAll(async () => { await migrate(); });
  afterEach(() => vi.unstubAllEnvs());

  it('blocks production manual checkout without taking the billing summary offline', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `production-${suffix}@example.test`, passwordHash: 'test' }).returning();
    const [org] = await db.insert(organizations).values({ name: 'Production', slug: `production-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: org.id, role: 'owner' });
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BILLING_PROVIDER', 'manual');
    const service = new BillingService(db);
    expect((await service.getSummary(owner.id, org.id)).payment).toMatchObject({ available: false });
    await expect(service.createOrder(owner.id, org.id, 'personal')).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_NOT_AVAILABLE' });
  });

  it('can reopen an unpaid order without creating another order or changing its plan', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `resume-${suffix}@example.test`, passwordHash: 'test' }).returning();
    const [org] = await db.insert(organizations).values({ name: 'Resume', slug: `resume-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: org.id, role: 'owner' });
    const service = new BillingService(db, { provider: new ManualBillingProvider() });
    const first = await service.createOrder(owner.id, org.id, 'personal');
    const retry = await service.createOrder(owner.id, org.id, 'personal');
    expect(retry.id).toBe(first.id);
    expect(retry.payment).toBeTruthy();
    await expect(service.createOrder(owner.id, org.id, 'team_10')).rejects.toMatchObject({ code: 'BILLING_PENDING_ORDER_EXISTS' });
    expect((await service.resumePayment(owner.id, org.id, first.id)).payment).toBeTruthy();
    await service.confirmManualOrder(owner.id, org.id, first.id);
    await expect(service.resumePayment(owner.id, org.id, first.id)).rejects.toMatchObject({ code: 'BILLING_ORDER_NOT_PAYABLE' });
  });

  it.each([
    { planCode: 'team_10' as const, amountCents: 48000, memberLimit: 10, canManageMembers: true },
    { planCode: 'personal' as const, amountCents: 12800, memberLimit: 1, canManageMembers: false },
  ])('uses catalog pricing and activates $planCode after payment', async ({ planCode, amountCents, memberLimit, canManageMembers }) => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `orders-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Orders', slug: `orders-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });
    const service = new BillingService(db, { now: () => new Date('2026-10-13T00:00:00.000Z'), provider: new ManualBillingProvider() });

    const created = await service.createOrder(owner.id, organization.id, planCode);
    expect(created).toMatchObject({ planCode, amountCents, status: 'pending', provider: 'manual' });
    const paid = await service.confirmManualOrder(owner.id, organization.id, created.id);
    const paidAgain = await service.confirmManualOrder(owner.id, organization.id, created.id);
    expect(paid).toMatchObject({ status: 'paid', amountCents });
    expect(paidAgain.id).toBe(paid.id);
    const summary = await service.getSummary(owner.id, organization.id);
    expect(summary.subscription).toMatchObject({ planCode, status: 'active' });
    expect(summary.policy).toMatchObject({ canCreateProject: true, canManageMembers, memberLimit, projectLimit: null });
    const renewal = await service.createOrder(owner.id, organization.id, planCode);
    expect(renewal).toMatchObject({ planCode, amountCents, status: 'pending' });
    await service.confirmManualOrder(owner.id, organization.id, renewal.id);
    expect((await service.getSummary(owner.id, organization.id)).subscription.periodEndsAt).toEqual(new Date('2028-10-13T00:00:00.000Z'));
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${owner.id}`;
  });

  it('requires the organization owner to buy a plan', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `orders-owner-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [member] = await db.insert(users).values({ email: `orders-member-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Owner', slug: `owner-${suffix}` }).returning();
    await db.insert(organizationMemberships).values([{ userId: owner.id, organizationId: organization.id, role: 'owner' }, { userId: member.id, organizationId: organization.id, role: 'member' }]);
    const service = new BillingService(db, { provider: new ManualBillingProvider() });
    await expect(service.createOrder(member.id, organization.id, 'team_10')).rejects.toMatchObject({ code: 'BILLING_OWNER_REQUIRED' } satisfies Partial<BillingError>);
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id in (${owner.id}, ${member.id})`;
  });

  it('replaces the organization placeholder in the Alipay return URL', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `orders-return-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Return URL', slug: `return-url-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });
    const priorReturnUrl = process.env.ALIPAY_RETURN_URL;
    const priorNotifyUrl = process.env.ALIPAY_NOTIFY_URL;
    process.env.ALIPAY_RETURN_URL = 'https://vibeplan.example/organizations/ORGANIZATION_ID/billing/return';
    process.env.ALIPAY_NOTIFY_URL = 'https://vibeplan.example/api/billing/alipay/notify';
    const provider: BillingProvider = {
      name: 'test',
      createPayment: async (input) => ({ provider: 'test', orderNo: input.orderNo, formAction: input.returnUrl, formFields: {} }),
      verifyNotification: () => { throw new Error('not used'); },
    };

    try {
      const created = await new BillingService(db, { provider }).createOrder(owner.id, organization.id, 'team_10');
      expect(created.payment?.formAction).toBe(`https://vibeplan.example/organizations/${organization.id}/billing/return`);
    } finally {
      if (priorReturnUrl === undefined) delete process.env.ALIPAY_RETURN_URL;
      else process.env.ALIPAY_RETURN_URL = priorReturnUrl;
      if (priorNotifyUrl === undefined) delete process.env.ALIPAY_NOTIFY_URL;
      else process.env.ALIPAY_NOTIFY_URL = priorNotifyUrl;
      await sqlClient`delete from organizations where id = ${organization.id}`;
      await sqlClient`delete from users where id = ${owner.id}`;
    }
  });
});
