# Collaboration Core MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted collaboration core where verified users join organizations and teams, manage project work items in real time, and connect a local CLI project to the server for Codex workflows.

**Architecture:** Use a pnpm TypeScript monorepo. A Fastify API owns authentication, organization/team/project authorization, work-item state, and SSE events backed by PostgreSQL. A React/Vite web app consumes the API, and a Commander-based CLI performs device login, project initialization, task start/report, and validation. Git and code indexing are integration points in this MVP, not remote execution features.

**Tech Stack:** Node.js 22, pnpm, TypeScript, Fastify, PostgreSQL, Drizzle ORM, Zod, Vitest, React, Vite, Commander, `keytar` for OS credential storage, Docker Compose.

---

## Task 1: Create the workspace and local infrastructure

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `apps/cli/package.json`
- Create: `packages/core/package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the workspace smoke test**

Create `packages/core/src/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('workspace', () => {
  it('loads the core package', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify the empty workspace fails**

Run: `pnpm vitest run packages/core/src/health.test.ts`
Expected: FAIL because the workspace scripts and package do not exist.

- [ ] **Step 3: Add the workspace files and scripts**

Use a root script that delegates to packages:

```json
{
  "name": "vibe-plan",
  "private": true,
  "packageManager": "pnpm@11.21.0",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --parallel --filter @vibeplan/api --filter @vibeplan/web dev",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Set `pnpm-workspace.yaml` to include `apps/*` and `packages/*`, add shared TypeScript options in `tsconfig.base.json`, and add PostgreSQL plus API/web environment values to `.env.example`. Add Docker Compose with PostgreSQL 16 on port `5432` and a named volume.

- [ ] **Step 4: Install dependencies and run the test**

Run: `pnpm install && pnpm vitest run packages/core/src/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .env.example docker-compose.yml apps packages vitest.config.ts pnpm-lock.yaml
git commit -m "chore: scaffold monorepo and local infrastructure"
```

## Task 2: Define shared domain schemas and work-item state transitions

**Files:**
- Create: `packages/core/src/auth.ts`
- Create: `packages/core/src/organizations.ts`
- Create: `packages/core/src/work-items.ts`
- Create: `packages/core/src/work-items.test.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write state transition tests**

Test that `backlog -> ready`, `ready -> in_progress`, `in_progress -> blocked`, `in_progress -> in_review`, `in_review -> done`, and `done -> in_progress` are respectively accepted or rejected according to the product state machine. Test that a `done` transition requires `acceptanceRecorded: true`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm vitest run packages/core/src/work-items.test.ts`
Expected: FAIL because the schemas and transition function do not exist.

- [ ] **Step 3: Implement Zod schemas and transition logic**

Define `WorkItemType`, `WorkItemStatus`, `Priority`, `WorkItem`, and `canTransition(input)` in `packages/core/src/work-items.ts`. The function must return `{ ok: true }` or `{ ok: false, reason: string }`, and must reject unknown statuses and invalid `done` transitions.

- [ ] **Step 4: Run the focused test**

Run: `pnpm vitest run packages/core/src/work-items.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat: add work item domain schemas and state machine"
```

## Task 3: Add the PostgreSQL schema and repository boundary

**Files:**
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/repositories/users.ts`
- Create: `apps/api/src/repositories/projects.ts`
- Create: `apps/api/src/repositories/work-items.ts`
- Create: `apps/api/src/db/schema.test.ts`

- [ ] **Step 1: Write repository contract tests**

Use a test database connection to verify that creating a user, organization membership, team membership, project, and work item preserves foreign keys and organization scope. Add a test that a project from another organization cannot be returned by a scoped project query.

- [ ] **Step 2: Start PostgreSQL and run the failing test**

Run: `docker compose up -d db && pnpm vitest run apps/api/src/db/schema.test.ts`
Expected: FAIL because migrations and repositories do not exist.

- [ ] **Step 3: Implement the schema**

Create tables for `users`, `organizations`, `organization_memberships`, `teams`, `team_memberships`, `projects`, `project_memberships`, `work_items`, `work_item_dependencies`, `task_events`, `email_tokens`, and `refresh_tokens`. Every project and work-item query must require an organization/project scope parameter.

- [ ] **Step 4: Run migrations and tests**

Run: `pnpm --filter @vibeplan/api db:migrate && pnpm vitest run apps/api/src/db/schema.test.ts`
Expected: PASS with all foreign-key and scope tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db apps/api/src/repositories apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add collaboration database schema and repositories"
```

## Task 4: Implement email authentication and device authorization

**Files:**
- Create: `apps/api/src/modules/auth/passwords.ts`
- Create: `apps/api/src/modules/auth/tokens.ts`
- Create: `apps/api/src/modules/auth/routes.ts`
- Create: `apps/api/src/modules/auth/service.ts`
- Create: `apps/api/src/modules/auth/auth.test.ts`
- Create: `apps/api/src/modules/mail/mailer.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`

- [ ] **Step 1: Write authentication tests**

Cover registration, duplicate normalized email rejection, unverified-login rejection, email verification token expiry and single use, password reset token single use, refresh-token rotation, and device-code exchange. Use a fake mailer and deterministic clock in unit tests.

- [ ] **Step 2: Run the failing authentication tests**

Run: `pnpm vitest run apps/api/src/modules/auth/auth.test.ts`
Expected: FAIL because the auth service and routes do not exist.

- [ ] **Step 3: Implement password and token services**

Use Argon2id or bcrypt for password hashes. Store only hashes of email-verification, password-reset, device, and refresh tokens. Make access tokens short lived and rotate refresh tokens on use. Do not log token values.

- [ ] **Step 4: Implement API routes**

Add `POST /auth/register`, `POST /auth/login`, `POST /auth/verify-email`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/device/start`, `POST /auth/device/exchange`, `POST /auth/refresh`, and `GET /auth/me`. Apply request validation and rate-limit registration, login, and mail-send routes.

- [ ] **Step 5: Run the authentication tests**

Run: `pnpm vitest run apps/api/src/modules/auth/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/modules/mail apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat: add email authentication and device authorization"
```

## Task 5: Implement organization, team, project, and permission APIs

**Files:**
- Create: `apps/api/src/modules/access/policy.ts`
- Create: `apps/api/src/modules/access/routes.ts`
- Create: `apps/api/src/modules/access/service.ts`
- Create: `apps/api/src/modules/access/access.test.ts`

- [ ] **Step 1: Write authorization tests**

Test that an authenticated user can only list organizations they belong to, team members can only see projects in their team, project viewers cannot mutate work items, and organization admins can manage teams. Test that cross-organization IDs return the same not-found response as inaccessible IDs.

- [ ] **Step 2: Run the failing authorization tests**

Run: `pnpm vitest run apps/api/src/modules/access/access.test.ts`
Expected: FAIL because policy and routes do not exist.

- [ ] **Step 3: Implement scoped policy functions**

Implement `requireOrganizationMember`, `requireTeamRole`, and `requireProjectRole`. The policy layer must run before repository writes and reads, not only in web handlers.

- [ ] **Step 4: Implement CRUD and invitation routes**

Add organization/team/project list and create routes, membership routes, and email invitation acceptance. New projects must be assigned to a team and a Git repository URL. Use stable server-generated project IDs.

- [ ] **Step 5: Run the authorization tests**

Run: `pnpm vitest run apps/api/src/modules/access/access.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/access
git commit -m "feat: add organization team project permissions"
```

## Task 6: Implement work-item APIs, events, and real-time updates

**Files:**
- Create: `apps/api/src/modules/work-items/routes.ts`
- Create: `apps/api/src/modules/work-items/service.ts`
- Create: `apps/api/src/modules/work-items/events.ts`
- Create: `apps/api/src/modules/work-items/work-items.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write API and optimistic-lock tests**

Test work-item creation, filtering by type/status/priority/assignee, dependency validation, comments, state transitions, and rejection of updates with a stale `version` value. Test that each accepted mutation creates a `TaskEvent`.

- [ ] **Step 2: Run the failing tests**

Run: `pnpm vitest run apps/api/src/modules/work-items/work-items.test.ts`
Expected: FAIL because work-item routes and event publisher do not exist.

- [ ] **Step 3: Implement the work-item service**

Use the shared `canTransition` function. Require project membership for reads, contributor-or-higher for task mutations, and maintainer-or-higher for project settings. Increment `version` for every mutation and append an event containing actor, action, and changed fields.

- [ ] **Step 4: Implement REST and SSE endpoints**

Add `GET/POST /projects/:projectId/work-items`, `GET/PATCH /work-items/:id`, `POST /work-items/:id/comments`, and `GET /projects/:projectId/events`. SSE connections must be scoped to a project the authenticated user can view.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/api/src/modules/work-items/work-items.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/work-items apps/api/src/app.ts
git commit -m "feat: add work item APIs and realtime events"
```

## Task 7: Build the web workspace

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/auth/LoginPage.tsx`
- Create: `apps/web/src/auth/RegisterPage.tsx`
- Create: `apps/web/src/workspace/WorkspacePage.tsx`
- Create: `apps/web/src/workspace/WorkItemBoard.tsx`
- Create: `apps/web/src/workspace/WorkItemDetail.tsx`
- Create: `apps/web/src/workspace/useProjectEvents.ts`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Write UI tests**

Test that unauthenticated users see login/register, authenticated users see only permitted organizations and teams, the board groups work items by status, and an SSE event invalidates the affected work-item query.

- [ ] **Step 2: Run the failing UI tests**

Run: `pnpm --filter @vibeplan/web test`
Expected: FAIL because the Vite app and components do not exist.

- [ ] **Step 3: Implement the web app**

Use a small query client wrapper around `fetch`, store the browser session in HttpOnly cookies, and render organization/team/project navigation followed by a board and detail panel. Do not place authorization decisions only in the UI; all API calls must handle `401` and `403`.

- [ ] **Step 4: Add SSE invalidation and form validation**

Connect to the selected project's event stream, refetch changed work items, and show a visible stale/conflict message when a PATCH returns `409`.

- [ ] **Step 5: Run the UI tests and build**

Run: `pnpm --filter @vibeplan/web test && pnpm --filter @vibeplan/web build`
Expected: PASS and a production bundle in `apps/web/dist`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add realtime project workspace web UI"
```

## Task 8: Build the local `vibeplan` CLI

**Files:**
- Create: `apps/cli/src/config.ts`
- Create: `apps/cli/src/auth.ts`
- Create: `apps/cli/src/api-client.ts`
- Create: `apps/cli/src/commands/login.ts`
- Create: `apps/cli/src/commands/init.ts`
- Create: `apps/cli/src/commands/task.ts`
- Create: `apps/cli/src/commands/check.ts`
- Create: `apps/cli/src/commands/whoami.ts`
- Create: `apps/cli/src/index.ts`
- Create: `apps/cli/src/cli.test.ts`

- [ ] **Step 1: Write CLI behavior tests**

Test command parsing, `vibeplan login` device flow using a fake API client, `vibeplan init --project-id` creation, same-project reinitialization, different-project refusal, `--force` backup, and task start/report request payloads.

- [ ] **Step 2: Run the failing CLI tests**

Run: `pnpm --filter @vibeplan/cli test`
Expected: FAIL because CLI commands do not exist.

- [ ] **Step 3: Implement config and credential storage**

Store non-secret project context in `.vibe/project.yaml`. Store access and refresh tokens with `keytar`; use a filesystem fallback only when explicitly enabled for headless development and print a warning. Never write tokens to project files.

- [ ] **Step 4: Implement commands**

Implement `vibeplan login`, `vibeplan whoami`, `vibeplan init --project-id`, `vibeplan org/team use`, `vibeplan task list/show/start/report`, and `vibeplan check`. `init` must back up conflicting `.vibe` state before `--force` replacement and must refuse inaccessible project IDs.

- [ ] **Step 5: Run CLI tests and build**

Run: `pnpm --filter @vibeplan/cli test && pnpm --filter @vibeplan/cli build`
Expected: PASS and a runnable CLI entrypoint.

- [ ] **Step 6: Commit**

```bash
git add apps/cli
git commit -m "feat: add local vibeplan project and task CLI"
```

## Task 9: Add project templates, Docker deployment, and end-to-end verification

**Files:**
- Create: `packages/templates/src/agents-md.ts`
- Create: `packages/templates/src/instructions-md.ts`
- Create: `apps/api/src/health.ts`
- Create: `docker/api.Dockerfile`
- Create: `docker/web.Dockerfile`
- Create: `docker-compose.prod.yml`
- Create: `tests/e2e/collaboration.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the end-to-end test**

Exercise: register a user, verify the email through the fake mailer, create an organization/team/project, create a work item, log in through the CLI test adapter, initialize a temporary Git directory, start and report the work item, and verify the web API sees the event.

- [ ] **Step 2: Run the failing end-to-end test**

Run: `docker compose up -d db && pnpm test -- tests/e2e/collaboration.test.ts`
Expected: FAIL because templates, production containers, and the integrated app are incomplete.

- [ ] **Step 3: Implement templates and health checks**

Generate a concise root `AGENTS.md` that points Codex to `.vibe/instructions.md`, and generate instructions that require task start/report, tests, and completion evidence. Add `GET /health` and make the web app show API connectivity state.

- [ ] **Step 4: Add production containers and README setup**

Document SMTP configuration, database migration, first-user registration, organization creation, CLI installation, `vibeplan init --project-id`, and local development commands. Keep secrets in environment variables and exclude `.env` from Git.

- [ ] **Step 5: Run all verification commands**

Run:

```bash
docker compose up -d db
pnpm lint
pnpm test
pnpm build
pnpm test -- tests/e2e/collaboration.test.ts
```

Expected: all commands pass; the API health endpoint responds; the web app loads; the CLI can initialize a permitted project.

- [ ] **Step 6: Commit**

```bash
git add packages/templates apps/api/src/health.ts docker docker-compose.prod.yml tests README.md
git commit -m "feat: package collaboration MVP for self hosted deployment"
```

## Deferred follow-up plan: Git graph and Understand-Anything adapter

After the collaboration MVP is working, create a separate plan for `vibeplan index`, Tree-sitter-based incremental indexing, task-to-code links, graph snapshot upload, and optional Understand-Anything import. This keeps graph analysis isolated from authentication and task synchronization.
