import { boolean, date, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  displayName: text('display_name'),
  ...timestamps,
}, (table) => ({ emailUnique: uniqueIndex('users_email_unique').on(table.email) }));

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
  repositoryUrl: text('repository_url').notNull(),
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
  estimate: integer('estimate'),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

export const workItemDependencies = pgTable('work_item_dependencies', {
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  dependsOnId: uuid('depends_on_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
}, (table) => ({ dependencyUnique: uniqueIndex('work_item_dependencies_unique').on(table.workItemId, table.dependsOnId) }));

export const taskEvents = pgTable('task_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
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
