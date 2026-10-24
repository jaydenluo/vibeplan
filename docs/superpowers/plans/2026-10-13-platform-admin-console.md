# Platform Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure `/admin` operations console for platform administrators to inspect users, organizations and billing orders, and for super administrators to manage platform access.

**Architecture:** Introduce a small `PlatformAdminService` that resolves environment bootstrap administrators plus persisted roles, and expose dedicated server-paginated `/admin/*` APIs. The existing SPA renders an independent admin view only after the API confirms access; all data and permissions remain server-enforced.

**Tech Stack:** TypeScript, Fastify, Drizzle/postgres.js, React, Vitest, pnpm workspaces.

---

### Task 1: Persist platform roles and audit events

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `.env.example`, `deploy/server/.env.example`, `deploy/server/docker-compose.yml`
- Test: `apps/api/src/db/schema.test.ts`

- [ ] Add failing schema tests asserting unique active administrator roles, audit event persistence, and idempotent migration SQL.
- [ ] Run the focused schema test and verify it fails before the tables/types exist.
- [ ] Add typed `platform_admins` and `platform_audit_logs` tables with role, actor and revocation columns; do not store credentials or raw payment payloads.
- [ ] Add idempotent migration statements and indexes for active-role lookup and audit chronology.
- [ ] Add `PLATFORM_ADMIN_EMAILS=` documentation and Docker environment passthrough, keeping real addresses only in the server `.env`.
- [ ] Re-run the schema test and API TypeScript build.

### Task 2: Implement server-side platform authorization and query APIs

**Files:**
- Create: `apps/api/src/modules/admin/service.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/admin/service.test.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] Write failing tests for no-access, environment bootstrap super-admin, database operator, list pagination/filtering, and super-admin-only role changes.
- [ ] Run the focused tests and observe authorization failures before implementation.
- [ ] Implement role resolution from `PLATFORM_ADMIN_EMAILS` plus active persisted rows; require a logged-in user and keep organization roles separate.
- [ ] Implement bounded, stable paginated queries for overview, users, organizations, and billing orders; select only display-safe fields and create one audit row per admin request.
- [ ] Implement administrator list/grant/revoke APIs. Require an existing user email, forbid revoking bootstrap super-admins and the last effective super-admin, and audit each change.
- [ ] Add Fastify `/admin/me`, `/admin/overview`, `/admin/users`, `/admin/organizations`, `/admin/orders`, and `/admin/admins` routes with zod query validation.
- [ ] Re-run focused API tests and `pnpm --filter @vibeplan/api build`.

### Task 3: Build the isolated admin route and data client

**Files:**
- Create: `apps/web/src/workspace/AdminConsolePage.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/workspace/AdminConsolePage.test.tsx`

- [ ] Add failing component tests for hiding the menu from non-admins, rendering overview data, order search/filtering, and withholding administrator mutation controls from operators.
- [ ] Run the focused component test and verify it fails before the page/client exist.
- [ ] Add typed client calls for admin identity, overview, paginated lists and super-admin role mutations; do not put authorization decisions or payment secrets in the browser.
- [ ] Add `/admin` route parsing and navigation. Load `/admin/me`; render the menu item only for confirmed administrators and render an access-denied state for direct unauthorized navigation.
- [ ] Build tabs for overview, users, organizations, orders and administrators using server-side filters, fixed-size tables, pagination and responsive detail expansion.
- [ ] Apply the existing workbench visual language with a restrained operations accent, visible focus states, and compact mobile table behavior.
- [ ] Re-run focused Web tests and `pnpm --filter @vibeplan/web build`.

### Task 4: Integrate, harden, and document operations access

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Create: `docs/admin-console.md`
- Test: `apps/api/src/app.test.ts`, `apps/web/src/app.test.tsx`

- [ ] Add integration tests showing a non-admin cannot call data routes or reveal the menu, while an operator can read data but cannot grant roles.
- [ ] Document first-super-admin bootstrap, environment variable rotation, permission separation, available views, excluded financial actions, audit behavior and safe deployment.
- [ ] Run `vibeplan check`, targeted API/Web tests, `pnpm -r build`, `git diff --check`, and a credential scan that excludes intentional variable placeholders.
- [ ] Inspect the final diff for accidental exposure of user data or server secrets. Do not auto-commit or deploy from the dirty worktree.

## Parallel Execution Boundaries

- Backend agent: Tasks 1–2. Owns schema, migration, server authorization/API and its tests.
- Frontend agent: Task 3. May stub exact API response types only until Task 2 lands; it must not modify backend code.
- Integration agent: Task 4 after both implementation agents finish. Owns docs and verification only.

## Acceptance Mapping

- Left-side menu visibility and direct `/admin` protection: Tasks 2–3.
- User, organization and recharge-record views: Tasks 2–3.
- Super-admin administration and audit: Tasks 1–2.
- Deployment/bootstrap instructions and safe verification: Task 4.
