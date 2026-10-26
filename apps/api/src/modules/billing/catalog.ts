import type { BillingPlanCode } from '../../db/schema.js';

export type BillingPlan = Readonly<{
  code: BillingPlanCode;
  name: string;
  annualPriceCents: number | null;
  seatLimit: number | null;
  projectLimit: number | null;
  publiclyPurchasable: boolean;
}>;

export const BILLING_PLANS: Readonly<Record<BillingPlanCode, BillingPlan>> = Object.freeze({
  free: { code: 'free', name: 'Personal Free', annualPriceCents: 0, seatLimit: 1, projectLimit: 50, publiclyPurchasable: false },
  personal: { code: 'personal', name: 'Personal', annualPriceCents: 12_800, seatLimit: 1, projectLimit: null, publiclyPurchasable: true },
  team_10: { code: 'team_10', name: 'Team 10', annualPriceCents: 48_000, seatLimit: 10, projectLimit: null, publiclyPurchasable: true },
  team_30: { code: 'team_30', name: 'Team 30', annualPriceCents: 128_000, seatLimit: 30, projectLimit: null, publiclyPurchasable: true },
  team_100: { code: 'team_100', name: 'Team 100', annualPriceCents: 368_000, seatLimit: 100, projectLimit: null, publiclyPurchasable: true },
  enterprise_1000: { code: 'enterprise_1000', name: 'Enterprise 1,000', annualPriceCents: 880_000, seatLimit: 1000, projectLimit: null, publiclyPurchasable: true },
  custom: { code: 'custom', name: 'Custom enterprise', annualPriceCents: null, seatLimit: null, projectLimit: null, publiclyPurchasable: false },
});

export function getBillingPlan(code: BillingPlanCode): BillingPlan {
  return BILLING_PLANS[code];
}
