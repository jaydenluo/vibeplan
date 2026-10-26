import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Add performance indexes based on code review findings
 * - Work items filtering by status, priority, assignee
 * - Task events ordering by sequence
 * - Work logs time range queries
 * - Refresh token lookups
 * - Organization subscriptions status checks
 */
export async function up(db: PostgresJsDatabase): Promise<void> {
  // Work items: frequently filtered columns
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_items_project_status ON work_items(project_id, status)`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_items_assignee ON work_items(assignee_id) WHERE assignee_id IS NOT NULL`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_items_due_date ON work_items(due_date) WHERE due_date IS NOT NULL`);

  // Task events: ordered by sequence for sync feed
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_events_project_sequence ON task_events(project_id, sequence DESC)`);

  // Work logs: time range queries
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_logs_work_item_date ON work_item_work_logs(work_item_id, work_date) WHERE revoked_at IS NULL`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_logs_user_date ON work_item_work_logs(user_id, work_date) WHERE revoked_at IS NULL`);

  // Refresh tokens: lookup by token hash
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL`);

  // Organization subscriptions: status checks
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_subscriptions_status ON organization_subscriptions(status, grace_ends_at)`);

  // Email tokens: cleanup expired tokens
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_tokens_expires ON email_tokens(expires_at) WHERE used_at IS NULL`);

  // Billing orders: find pending orders
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_orders_org_status ON billing_orders(organization_id, status, created_at DESC)`);
}

export async function down(db: PostgresJsDatabase): Promise<void> {
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_work_items_project_status`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_work_items_assignee`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_work_items_due_date`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_task_events_project_sequence`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_work_logs_work_item_date`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_work_logs_user_date`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_refresh_tokens_hash`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_org_subscriptions_status`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_email_tokens_expires`);
  await db.execute(sql`DROP INDEX CONCURRENTLY IF EXISTS idx_billing_orders_org_status`);
}
