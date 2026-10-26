import { bigint, date, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export type BillingPlanCode = 'free' | 'personal' | 'team_10' | 'team_30' | 'team_100' | 'enterprise_1000' | 'custom';
export type BillingSubscriptionStatus = 'active' | 'grace' | 'expired' | 'cancelled' | 'manual';
export type BillingOrderStatus = 'pending' | 'paid' | 'scheduled' | 'closed' | 'refunded' | 'failed';
export type PlatformAdminRole = 'super_admin' | 'operator';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  displayName: text('display_name'),
  ...timestamps,
}, (table) => ({ emailUnique: uniqueIndex('users_email_unique').on(table.email) }));

export const platformAdmins = pgTable('platform_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<PlatformAdminRole>().notNull(),
  grantedByUserId: uuid('granted_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  ...timestamps,
}, (table) => ({ userUnique: uniqueIndex('platform_admins_user_unique').on(table.userId) }));

export const platformAuditLogs = pgTable('platform_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ chronology: uniqueIndex('platform_audit_logs_chronology').on(table.createdAt, table.id) }));

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ...timestamps,
}, (table) => ({ slugUnique: uniqueIndex('organizations_slug_unique').on(table.slug) }));

export const organizationMemberships = pgTable('organization_memberships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  ...timestamps,
}, (table) => ({ membershipUnique: uniqueIndex('organization_memberships_unique').on(table.userId, table.organizationId) }));

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  ...timestamps,
}, (table) => ({ slugUnique: uniqueIndex('teams_organization_slug_unique').on(table.organizationId, table.slug) }));

export const organizationSubscriptions = pgTable('organization_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  planCode: text('plan_code').$type<BillingPlanCode>().notNull(),
  status: text('status').$type<BillingSubscriptionStatus>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  seatLimit: integer('seat_limit'),
  projectLimit: integer('project_limit'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }).notNull(),
  scheduledPlanCode: text('scheduled_plan_code').$type<BillingPlanCode>(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  provider: text('provider').notNull(),
  providerSubscriptionId: text('provider_subscription_id'),
  currentOrderReference: text('current_order_reference'),
  ...timestamps,
}, (table) => ({ organizationUnique: uniqueIndex('organization_subscriptions_organization_unique').on(table.organizationId) }));

export const billingOrders = pgTable('billing_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  purchaserId: uuid('purchaser_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  orderNo: text('order_no').notNull(),
  planCode: text('plan_code').$type<BillingPlanCode>().notNull(),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('CNY'),
  status: text('status').$type<BillingOrderStatus>().notNull().default('pending'),
  provider: text('provider').notNull(),
  providerOrderId: text('provider_order_id'),
  providerTransactionId: text('provider_transaction_id'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  planSnapshot: jsonb('plan_snapshot').$type<Record<string, unknown>>().notNull().default({}),
  providerMetadata: jsonb('provider_metadata').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => ({
  orderNoUnique: uniqueIndex('billing_orders_order_no_unique').on(table.orderNo),
  providerTransactionUnique: uniqueIndex('billing_orders_provider_transaction_unique').on(table.provider, table.providerTransactionId),
}));

export const billingProviderNotifications = pgTable('billing_provider_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  billingOrderId: uuid('billing_order_id').references(() => billingOrders.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  notificationId: text('notification_id').notNull(),
  providerTransactionId: text('provider_transaction_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  verificationResult: text('verification_result').notNull(),
  verificationError: text('verification_error'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => ({ providerNotificationUnique: uniqueIndex('billing_provider_notifications_unique').on(table.provider, table.notificationId) }));

export const teamMemberships = pgTable('team_memberships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  ...timestamps,
}, (table) => ({ membershipUnique: uniqueIndex('team_memberships_unique').on(table.userId, table.teamId) }));

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description').notNull().default(''),
  repositoryUrl: text('repository_url'),
  ...timestamps,
}, (table) => ({ slugUnique: uniqueIndex('projects_team_slug_unique').on(table.teamId, table.slug) }));

export const projectMemberships = pgTable('project_memberships', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  ...timestamps,
}, (table) => ({ membershipUnique: uniqueIndex('project_memberships_unique').on(table.userId, table.projectId) }));

export const workItems = pgTable('work_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  type: text('type').notNull(),
  status: text('status').notNull(),
  priority: text('priority').notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  dueDate: date('due_date'),
  labels: jsonb('labels').$type<string[]>().notNull().default([]),
  component: text('component'),
  parentId: uuid('parent_id'),
  dependsOn: jsonb('depends_on').$type<string[]>().notNull().default([]),
  acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().notNull().default([]),
  acceptanceItems: jsonb('acceptance_items').$type<Array<{
    id: string;
    text: string;
    required: boolean;
    status: 'unverified' | 'passed' | 'failed' | 'needs_info';
    comment: string;
    evidence: Array<{ label: string; url: string }>;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }>>().notNull().default([]),
  estimate: integer('estimate'),
  actualHours: numeric('actual_hours', { precision: 8, scale: 2 }),
  planMarkdown: text('plan_markdown'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  progress: integer('progress').notNull().default(0),
  acceptanceCycle: integer('acceptance_cycle').notNull().default(1),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

export const workItemDependencies = pgTable('work_item_dependencies', {
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  dependsOnId: uuid('depends_on_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
}, (table) => ({ dependencyUnique: uniqueIndex('work_item_dependencies_unique').on(table.workItemId, table.dependsOnId) }));

export const projectMilestones = pgTable('project_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  targetDate: date('target_date'),
  status: text('status').notNull().default('open'),
  ...timestamps,
});

export const workItemMilestones = pgTable('work_item_milestones', {
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  milestoneId: uuid('milestone_id').notNull().references(() => projectMilestones.id, { onDelete: 'cascade' }),
}, (table) => ({ milestoneUnique: uniqueIndex('work_item_milestones_unique').on(table.workItemId, table.milestoneId) }));

export const workItemWorkLogs = pgTable('work_item_work_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  hours: numeric('hours', { precision: 8, scale: 2 }).notNull(),
  content: text('content').notNull().default(''),
  workDate: date('work_date').notNull(),
  version: integer('version').notNull().default(1),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
});

export const taskEvents = pgTable('task_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  sequence: bigint('sequence', { mode: 'number' }).notNull().default(0),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const emailTokens = pgTable('email_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  purpose: text('purpose').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const registrationCodes = pgTable('registration_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  ...timestamps,
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
});

export const deviceCodes = pgTable('device_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userCode: text('user_code').notNull(),
  deviceCodeHash: text('device_code_hash').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const organizationInvitations = pgTable('organization_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  inviterId: uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'),
  status: text('status').notNull().default('pending'),
  ...timestamps,
}, (table) => ({ pendingUnique: uniqueIndex('organization_invitations_unique').on(table.organizationId, table.teamId, table.email, table.status) }));

export const membershipInvites = pgTable('membership_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  inviterId: uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
}, (table) => ({ tokenHashUnique: uniqueIndex('membership_invites_token_hash_unique').on(table.tokenHash) }));

export const teamJoinRequests = pgTable('team_join_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  ...timestamps,
}, (table) => ({ pendingUnique: uniqueIndex('team_join_requests_unique').on(table.teamId, table.userId, table.status) }));
