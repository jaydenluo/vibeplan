import { sqlClient } from './client.js';

const statements = [
  `create table if not exists users (id uuid primary key default gen_random_uuid(), email text not null unique, password_hash text not null, email_verified_at timestamptz, display_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists platform_admins (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, role text not null, granted_by_user_id uuid not null references users(id) on delete restrict, revoked_at timestamptz, revoked_by_user_id uuid references users(id) on delete restrict, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create unique index if not exists platform_admins_user_unique on platform_admins (user_id)`,
  `create index if not exists platform_admins_active_role on platform_admins (role, user_id) where revoked_at is null`,
  `create table if not exists platform_audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid not null references users(id) on delete restrict, action text not null, target_type text not null, target_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now())`,
  `create index if not exists platform_audit_logs_chronology on platform_audit_logs (created_at desc, id desc)`,
  `create table if not exists organizations (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists organization_memberships (user_id uuid not null references users(id) on delete cascade, organization_id uuid not null references organizations(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, organization_id))`,
  `create table if not exists teams (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, name text not null, slug text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, slug))`,
  `create table if not exists team_memberships (user_id uuid not null references users(id) on delete cascade, team_id uuid not null references teams(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, team_id))`,
  `create table if not exists organization_subscriptions (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, plan_code text not null, status text not null, amount_cents integer not null, seat_limit integer, project_limit integer, period_start timestamptz not null, period_end timestamptz not null, grace_ends_at timestamptz not null, scheduled_plan_code text, scheduled_at timestamptz, provider text not null, provider_subscription_id text, current_order_reference text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create unique index if not exists organization_subscriptions_organization_unique on organization_subscriptions (organization_id)`,
  `create table if not exists billing_orders (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, purchaser_id uuid not null references users(id) on delete restrict, order_no text not null, plan_code text not null, amount_cents integer not null, currency text not null default 'CNY', status text not null default 'pending', provider text not null, provider_order_id text, provider_transaction_id text, period_start timestamptz not null, period_end timestamptz not null, paid_at timestamptz, closed_at timestamptz, refunded_at timestamptz, plan_snapshot jsonb not null default '{}'::jsonb, provider_metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create unique index if not exists billing_orders_order_no_unique on billing_orders (order_no)`,
  `create unique index if not exists billing_orders_provider_transaction_unique on billing_orders (provider, provider_transaction_id) where provider_transaction_id is not null`,
  `create table if not exists billing_provider_notifications (id uuid primary key default gen_random_uuid(), billing_order_id uuid references billing_orders(id) on delete set null, provider text not null, notification_id text not null, provider_transaction_id text, payload jsonb not null default '{}'::jsonb, verification_result text not null, verification_error text, verified_at timestamptz, processed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create unique index if not exists billing_provider_notifications_unique on billing_provider_notifications (provider, notification_id)`,
  `create table if not exists projects (id uuid primary key default gen_random_uuid(), team_id uuid not null references teams(id) on delete cascade, name text not null, slug text not null, repository_url text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (team_id, slug))`,
  `create table if not exists project_memberships (user_id uuid not null references users(id) on delete cascade, project_id uuid not null references projects(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, project_id))`,
  `create table if not exists work_items (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, title text not null, description text not null default '', type text not null, status text not null, priority text not null, assignee_id uuid references users(id) on delete set null, reporter_id uuid not null references users(id) on delete restrict, due_date date, labels jsonb not null default '[]'::jsonb, component text, parent_id uuid, depends_on jsonb not null default '[]'::jsonb, acceptance_criteria jsonb not null default '[]'::jsonb, estimate integer, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists work_item_dependencies (work_item_id uuid not null references work_items(id) on delete cascade, depends_on_id uuid not null references work_items(id) on delete cascade, primary key (work_item_id, depends_on_id))`,
  `insert into work_item_dependencies (work_item_id, depends_on_id) select wi.id, dependency.value::uuid from work_items wi cross join lateral jsonb_array_elements_text(wi.depends_on) dependency(value) join work_items dep on dep.id = dependency.value::uuid and dep.project_id = wi.project_id where dependency.value ~* '^[0-9a-f-]{36}$' on conflict do nothing`,
  `create table if not exists task_events (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, work_item_id uuid references work_items(id) on delete cascade, actor_id uuid not null references users(id) on delete restrict, action text not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists email_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, token_hash text not null, purpose text not null, expires_at timestamptz not null, used_at timestamptz)`,
  `create table if not exists registration_codes (id uuid primary key default gen_random_uuid(), email text not null, code_hash text not null, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists refresh_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, token_hash text not null, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists device_codes (id uuid primary key default gen_random_uuid(), user_code text not null, device_code_hash text not null, user_id uuid references users(id) on delete cascade, expires_at timestamptz not null, approved_at timestamptz, consumed_at timestamptz)`,
  `create table if not exists organization_invitations (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, team_id uuid references teams(id) on delete cascade, email text not null, inviter_id uuid not null references users(id) on delete cascade, role text not null default 'member', status text not null default 'pending', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, team_id, email, status))`,
  `create table if not exists membership_invites (id uuid primary key default gen_random_uuid(), token_hash text not null unique, organization_id uuid not null references organizations(id) on delete cascade, team_id uuid references teams(id) on delete cascade, inviter_id uuid not null references users(id) on delete cascade, status text not null default 'active', expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists team_join_requests (id uuid primary key default gen_random_uuid(), team_id uuid not null references teams(id) on delete cascade, user_id uuid not null references users(id) on delete cascade, status text not null default 'pending', reviewed_by uuid references users(id) on delete set null, reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (team_id, user_id, status))`,
  `alter table if exists projects alter column repository_url drop not null`,
  `alter table if exists projects add column if not exists description text not null default ''`,
  `alter table if exists work_items add column if not exists progress integer not null default 0`,
  `alter table if exists work_items add column if not exists acceptance_items jsonb not null default '[]'::jsonb`,
  `alter table if exists work_items add column if not exists actual_hours numeric(8,2)`,
  `alter table if exists work_items add column if not exists plan_markdown text`,
  `alter table if exists work_items add column if not exists started_at timestamptz`,
  `update work_items child set parent_id = null where parent_id is not null and not exists (select 1 from work_items parent where parent.id = child.parent_id and parent.project_id = child.project_id)`,
  `with recursive ancestry as (
    select id, parent_id, array[id] as path, false as cycle from work_items where parent_id is not null
    union all
    select a.id, parent.parent_id, a.path || parent.id, parent.id = any(a.path)
    from ancestry a join work_items parent on parent.id = a.parent_id
    where not a.cycle and a.parent_id is not null
  ), cyclic as (select distinct id from ancestry where cycle)
  update work_items set parent_id = null where id in (select id from cyclic)`,
  `alter table if exists work_items drop constraint if exists work_items_parent_id_fkey`,
  `alter table if exists work_items add constraint work_items_parent_id_fkey foreign key (parent_id) references work_items(id) on delete set null`,
  `create table if not exists project_milestones (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, name text not null, description text not null default '', target_date date, status text not null default 'open', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists work_item_milestones (work_item_id uuid not null references work_items(id) on delete cascade, milestone_id uuid not null references project_milestones(id) on delete cascade, primary key (work_item_id, milestone_id))`,
  `create table if not exists work_item_work_logs (id uuid primary key default gen_random_uuid(), work_item_id uuid not null references work_items(id) on delete cascade, user_id uuid not null references users(id) on delete cascade, hours numeric(8,2) not null, content text not null default '', work_date date not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `alter table work_items add column if not exists acceptance_cycle integer not null default 1`,
  `alter table task_events add column if not exists sequence bigint not null default 0`,
  `alter table work_item_work_logs add column if not exists version integer not null default 1`,
  `alter table work_item_work_logs add column if not exists revoked_at timestamptz`,
  `create table if not exists task_mutations (actor_id uuid not null references users(id) on delete cascade, mutation_id uuid not null, project_id uuid not null references projects(id) on delete cascade, request_hash text not null, result jsonb not null, created_at timestamptz not null default now(), primary key(actor_id, mutation_id))`,
  `create table if not exists project_sync_heads (project_id uuid primary key references projects(id) on delete cascade, sequence bigint not null default 0, minimum_cursor bigint not null default 0)`,
  `create table if not exists project_sync_changes (project_id uuid not null references projects(id) on delete cascade, sequence bigint not null, work_item_id uuid not null, action text not null, created_at timestamptz not null default now(), primary key(project_id, sequence))`,
];

export async function migrate(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`create extension if not exists pgcrypto`;
    for (const statement of statements) await tx.unsafe(statement);
  });
}

if (process.argv[1]?.endsWith('/migrate.ts') || process.argv[1]?.endsWith('/migrate.js')) {
  try {
    await migrate();
    console.log('✅ Database migration completed successfully');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    process.exitCode = 1;
  } finally {
    await sqlClient.end();
  }
}
