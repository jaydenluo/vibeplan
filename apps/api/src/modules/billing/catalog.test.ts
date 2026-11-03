import { expect, it } from 'vitest';
import { getBillingPlan } from './catalog.js';

it('includes 50 projects in the free plan without a purchasable subscription', () => {
  expect(getBillingPlan('free')).toMatchObject({ projectLimit: 50, annualPriceCents: 0, publiclyPurchasable: false });
});

it('offers the merged free plan to three members with 50 aggregate projects', () => {
  expect(getBillingPlan('free')).toMatchObject({ name: 'Free', annualPriceCents: 0, seatLimit: 3, projectLimit: 50, publiclyPurchasable: false });
});
