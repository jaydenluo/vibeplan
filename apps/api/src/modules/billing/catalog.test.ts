import { expect, it } from 'vitest';
import { getBillingPlan } from './catalog.js';

it('includes 50 projects in the free plan without a purchasable subscription', () => {
  expect(getBillingPlan('free')).toMatchObject({ projectLimit: 50, annualPriceCents: 0, publiclyPurchasable: false });
});

it('offers a personal annual plan for 128 yuan with one seat and unlimited projects', () => {
  expect(getBillingPlan('personal')).toMatchObject({ annualPriceCents: 12800, seatLimit: 1, projectLimit: null, publiclyPurchasable: true });
});
