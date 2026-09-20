import { sqlClient } from './client.js';

const statements = [
  `create table if not exists users (id uuid primary key default gen_random_uuid(), email text not null unique, password_hash text not null, email_verified_at timestamptz, display_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists organizations (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists organization_memberships (user_id uuid not null references users(id) on delete cascade, organization_id uuid not null references organizations(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, organization_id))`,
  `create table if not exists teams (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade, name text not null, slug text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id, slug))`,
  `create table if not exists team_memberships (user_id uuid not null references users(id) on delete cascade, team_id uuid not null references teams(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, team_id))`,
  `create table if not exists projects (id uuid primary key default gen_random_uuid(), team_id uuid not null references teams(id) on delete cascade, name text not null, slug text not null, repository_url text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (team_id, slug))`,
  `create table if not exists project_memberships (user_id uuid not null references users(id) on delete cascade, project_id uuid not null references projects(id) on delete cascade, role text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (user_id, project_id))`,
  `create table if not exists work_items (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, title text not null, description text not null default '', type text not null, status text not null, priority text not null, assignee_id uuid references users(id) on delete set null, reporter_id uuid not null references users(id) on delete restrict, due_date date, labels jsonb not null default '[]'::jsonb, component text, parent_id uuid, depends_on jsonb not null default '[]'::jsonb, acceptance_criteria jsonb not null default '[]'::jsonb, estimate integer, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists work_item_dependencies (work_item_id uuid not null references work_items(id) on delete cascade, depends_on_id uuid not null references work_items(id) on delete cascade, primary key (work_item_id, depends_on_id))`,
  `create table if not exists task_events (id uuid primary key default gen_random_uuid(), project_id uuid not null references projects(id) on delete cascade, work_item_id uuid references work_items(id) on delete cascade, actor_id uuid not null references users(id) on delete restrict, action text not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists email_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, token_hash text not null, purpose text not null, expires_at timestamptz not null, used_at timestamptz)`,
  `create table if not exists refresh_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, token_hash text not null, expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists device_codes (id uuid primary key default gen_random_uuid(), user_code text not null, device_code_hash text not null, user_id uuid references users(id) on delete cascade, expires_at timestamptz not null, approved_at timestamptz, consumed_at timestamptz)`,
];

export async function migrate(): Promise<void> {
  await sqlClient`create extension if not exists pgcrypto`;
  for (const statement of statements) {
    await sqlClient.unsafe(statement);
  }
}

if (process.argv[1]?.endsWith('/migrate.ts')) {
  await migrate();
  await sqlClient.end();
}
