import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { organizationMemberships, organizations, users } from '../../db/schema.js';
import { ManualBillingProvider } from './providers/manual.js';
import type { BillingProvider } from './providers/types.js';
import { BillingError, BillingService } from './service.js';

describe('BillingService orders', () => {
  beforeAll(async () => { await migrate(); });

  it('uses server catalog prices, confirms manual payment once, and activates a subscription', async () => {
    const suffix = randomUUID();
    const [owner] = await db.insert(users).values({ email: `orders-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const [organization] = await db.insert(organizations).values({ name: 'Orders', slug: `orders-${suffix}` }).returning();
    await db.insert(organizationMemberships).values({ userId: owner.id, organizationId: organization.id, role: 'owner' });
    const service = new BillingService(db, { now: () => new Date('2026-10-13T00:00:00.000Z'), provider: new ManualBillingProvider() });

    const created = await service.createOrder(owner.id, organization.id, 'team_10');
    expect(created).toMatchObject({ planCode: 'team_10', amountCents: 48000, status: 'pending', provider: 'manual' });
    const paid = await service.confirmManualOrder(owner.id, organization.id, created.id);
    const paidAgain = await service.confirmManualOrder(owner.id, organization.id, created.id);
    expect(paid).toMatchObject({ status: 'paid', amountCents: 48000 });
    expect(paidAgain.id).toBe(paid.id);
    const summary = await service.getSummary(owner.id, organization.id);
    expect(summary.subscription).toMatchObject({ planCode: 'team_10', status: 'active' });
    expect(summary.policy).toMatchObject({ canCreateProject: true, canManageMembers: true });
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
