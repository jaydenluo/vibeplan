import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { organizationMemberships, organizationSubscriptions, projects, teams, type BillingPlanCode, type BillingSubscriptionStatus } from '../../db/schema.js';
import { getBillingPlan } from './catalog.js';

export type BillingEntitlementCode =
  | 'BILLING_ORGANIZATION_NOT_FOUND'
  | 'BILLING_ORGANIZATION_READ_ONLY'
  | 'BILLING_FREE_PROJECT_LIMIT_REACHED'
  | 'BILLING_FREE_PLAN_MEMBERSHIP_LOCKED'
  | 'BILLING_SEAT_LIMIT_EXCEEDED';

export class BillingEntitlementError extends Error {
  readonly statusCode = 403;

  constructor(public readonly code: BillingEntitlementCode, message: string) {
    super(message);
    this.name = 'BillingEntitlementError';
  }
}

export type OrganizationPolicy = Readonly<{
  organizationId: string;
  ownerId: string;
  planCode: BillingPlanCode;
  subscriptionStatus: BillingSubscriptionStatus | 'free';
  state: 'free' | 'active' | 'grace' | 'read_only';
  canWrite: boolean;
  canCreateProject: boolean;
  canAddMember: boolean;
  memberUsage: { used: number; limit: number | null };
  projectUsage: { used: number; limit: number | null };
  periodEnd: Date | null;
  graceEndsAt: Date | null;
  denialCode: BillingEntitlementCode | null;
}>;

type Subscription = typeof organizationSubscriptions.$inferSelect;

function subscriptionState(subscription: Subscription | undefined, now: Date): OrganizationPolicy['state'] {
  if (!subscription) return 'free';
  if (subscription.status === 'cancelled' || subscription.status === 'expired') return 'read_only';
  if (now < subscription.periodEnd) return 'active';
  if (now < subscription.graceEndsAt) return 'grace';
  return 'read_only';
}

function effectivePlanCode(subscription: Subscription | undefined): BillingPlanCode {
  if (!subscription) return 'free';
  // A scheduled downgrade is a renewal preference. Because subscriptions never
  // auto-charge, it cannot activate a new paid period by itself.
  return subscription.planCode;
}

export class EntitlementService {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getOrganizationPolicy(organizationId: string): Promise<OrganizationPolicy> {
    const currentTime = this.now();
    const memberships = await this.database.select({ userId: organizationMemberships.userId, role: organizationMemberships.role })
      .from(organizationMemberships).where(eq(organizationMemberships.organizationId, organizationId));
    const owner = memberships.find((membership) => membership.role === 'owner');
    if (!owner) throw new BillingEntitlementError('BILLING_ORGANIZATION_NOT_FOUND', 'Organization ownership could not be found.');

    const [subscription] = await this.database.select().from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1);
    const state = subscriptionState(subscription, currentTime);
    const planCode = effectivePlanCode(subscription);
    const plan = getBillingPlan(planCode);
    const memberUsage = { used: memberships.length, limit: plan.seatLimit };
    const paidOrganization = state === 'active' || state === 'grace';
    const projectUsage = paidOrganization
      ? { used: await this.projectCountForOrganizations([organizationId]), limit: null }
      : { used: await this.freeProjectCountForOwner(owner.userId, currentTime), limit: getBillingPlan('free').projectLimit };
    // Free-plan membership mutations are blocked separately. Legacy organizations that
    // already contain members must remain usable after this feature is deployed.
    const overSeats = planCode !== 'free' && plan.seatLimit !== null && memberUsage.used > plan.seatLimit;
    const stateBlocked = state === 'read_only';
    const canWrite = !stateBlocked && !overSeats;
    const canCreateProject = canWrite && (paidOrganization || projectUsage.used < (projectUsage.limit ?? Infinity));
    const canAddMember = canWrite && paidOrganization && (plan.seatLimit === null || memberUsage.used < plan.seatLimit);
    const denialCode = stateBlocked
      ? 'BILLING_ORGANIZATION_READ_ONLY'
      : overSeats
        ? 'BILLING_SEAT_LIMIT_EXCEEDED'
        : !paidOrganization
          ? 'BILLING_FREE_PLAN_MEMBERSHIP_LOCKED'
          : !canCreateProject
            ? 'BILLING_FREE_PROJECT_LIMIT_REACHED'
            : null;

    return {
      organizationId,
      ownerId: owner.userId,
      planCode,
      subscriptionStatus: subscription?.status ?? 'free',
      state,
      canWrite,
      canCreateProject,
      canAddMember,
      memberUsage,
      projectUsage,
      periodEnd: subscription?.periodEnd ?? null,
      graceEndsAt: subscription?.graceEndsAt ?? null,
      denialCode,
    };
  }

  async assertCanWrite(organizationId: string): Promise<OrganizationPolicy> {
    const policy = await this.getOrganizationPolicy(organizationId);
    if (!policy.canWrite) throw new BillingEntitlementError(policy.denialCode ?? 'BILLING_ORGANIZATION_READ_ONLY', 'This organization is read-only until its subscription is renewed or usage is reduced.');
    return policy;
  }

  async assertCanCreateProject(organizationId: string): Promise<OrganizationPolicy> {
    const policy = await this.getOrganizationPolicy(organizationId);
    if (!policy.canCreateProject) throw new BillingEntitlementError(policy.denialCode ?? 'BILLING_FREE_PROJECT_LIMIT_REACHED', 'The project limit for this organization has been reached.');
    return policy;
  }

  async assertCanAddMember(organizationId: string, userId?: string): Promise<OrganizationPolicy> {
    const policy = await this.getOrganizationPolicy(organizationId);
    if (!policy.canWrite) {
      throw new BillingEntitlementError(policy.denialCode ?? 'BILLING_ORGANIZATION_READ_ONLY', 'This organization is read-only until its subscription is renewed or usage is reduced.');
    }
    if (userId) {
      const [existing] = await this.database.select({ userId: organizationMemberships.userId }).from(organizationMemberships)
        .where(and(eq(organizationMemberships.organizationId, organizationId), eq(organizationMemberships.userId, userId))).limit(1);
      if (existing) return policy;
    }
    if (!policy.canAddMember) {
      const code = policy.state === 'free' ? 'BILLING_FREE_PLAN_MEMBERSHIP_LOCKED' : policy.denialCode ?? 'BILLING_SEAT_LIMIT_EXCEEDED';
      throw new BillingEntitlementError(code, 'This organization cannot add another member under its current plan.');
    }
    return policy;
  }

  private async freeProjectCountForOwner(ownerId: string, now: Date): Promise<number> {
    const ownedOrganizations = await this.database.select({ organizationId: organizationMemberships.organizationId })
      .from(organizationMemberships).where(and(eq(organizationMemberships.userId, ownerId), eq(organizationMemberships.role, 'owner')));
    if (!ownedOrganizations.length) return 0;
    const organizationIds = ownedOrganizations.map((organization) => organization.organizationId);
    const subscriptions = await this.database.select().from(organizationSubscriptions)
      .where(inArray(organizationSubscriptions.organizationId, organizationIds));
    const paidIds = new Set(subscriptions.filter((subscription) => {
      const state = subscriptionState(subscription, now);
      return state === 'active' || state === 'grace';
    }).map((subscription) => subscription.organizationId));
    return this.projectCountForOrganizations(organizationIds.filter((organizationId) => !paidIds.has(organizationId)));
  }

  private async projectCountForOrganizations(organizationIds: string[]): Promise<number> {
    if (!organizationIds.length) return 0;
    const teamRows = await this.database.select({ id: teams.id }).from(teams).where(inArray(teams.organizationId, organizationIds));
    if (!teamRows.length) return 0;
    const projectRows = await this.database.select({ id: projects.id }).from(projects).where(inArray(projects.teamId, teamRows.map((team) => team.id)));
    return projectRows.length;
  }
}
