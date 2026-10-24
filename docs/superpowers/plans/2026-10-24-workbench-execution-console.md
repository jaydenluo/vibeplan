# Workbench Execution Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the organization workbench a reliable execution console for all members and remove the visible 404/error states shown in the current screenshot.

**Architecture:** Reuse the existing authenticated organization overview and personal-work APIs, keep organization selection in `WorkspacePage`, and make `OrganizationOverview` and `TodayWork` render neutral loading/empty states while `apiRequest` owns error messages. Verify the source API routes, proxy path, image version, and deployment verification so an old API image cannot silently remain behind the Web container.

**Tech Stack:** React 19, TypeScript, Vite, Fastify, Vitest, Docker Compose, Traefik/Nginx reverse proxy.

---

### Task 1: Lock the API and deployment contract with failing tests

**Files:**
- Modify: `apps/api/src/app.test.ts`
- Modify: `scripts/verify-release.sh`
- Test: `apps/api/src/app.test.ts`

- [x] **Step 1: Add an API route regression test**

Add a test that authenticates an organization member and requests both `/organizations/:organizationId/overview` and `/organizations/:organizationId/my-work`, asserting HTTP 200 and the required top-level fields. Add a non-member assertion expecting the existing access error status.

- [x] **Step 2: Run the focused API test and verify the contract**

Run:

```bash
pnpm vitest run --fileParallelism=false apps/api/src/app.test.ts
```

Expected: the new route assertions pass against the current source API; if they fail, fix the route/service contract before touching the Web UI.

- [x] **Step 3: Extend release verification for the running API version**

Update `scripts/verify-release.sh` to keep checking `/health` and `/version`, and print the exact image/version/build response used by the deployment. Add a clear failure message when the requested release is not the running API version. Do not make unauthenticated business requests to the two organization endpoints.

- [x] **Step 4: Run the release script shell checks**

Run:

```bash
bash -n scripts/verify-release.sh
```

Expected: exit 0.

### Task 2: Remove page-level network error rendering

**Files:**
- Modify: `apps/web/src/workspace/TaskReportForm.tsx`
- Modify: `apps/web/src/workspace/BillingPage.tsx`
- Modify: `apps/web/src/workspace/OrganizationOverview.tsx`
- Modify: `apps/web/src/workspace/TodayWork.tsx`
- Modify: `apps/web/src/workspace/InviteAcceptanceModal.tsx`
- Modify: `apps/web/src/workspace/TaskProjectTabs.tsx`
- Modify: corresponding Web tests

- [x] **Step 1: Add failing assertions for global-only errors**

Update the affected tests to listen to `messageEvent` and assert that failed requests emit the expected message while the page does not render the raw API error or a duplicate `role="alert"` node. Keep business warnings such as subscription read-only state covered separately.

- [x] **Step 2: Run the focused Web tests and verify they fail for the current inline error nodes**

Run:

```bash
pnpm vitest run --fileParallelism=false apps/web/src/workspace/TaskReportForm.test.tsx apps/web/src/workspace/BillingPage.test.tsx apps/web/src/workspace/OrganizationOverview.test.tsx apps/web/src/workspace/TodayWork.test.tsx
```

Expected: failures identify the current page-level error rendering.

- [x] **Step 3: Remove duplicate error state from form and load-failure branches**

Keep local state only for loading/data availability. Validation callbacks call `showMessage(message, 'error')`; API catches do not render `cause.message`. Failed data loads show neutral empty text and a retry control where the page already has one.

- [x] **Step 4: Run the focused Web tests again**

Run the same command from Step 2. Expected: all focused tests pass and no page contains the API error string.

### Task 3: Complete the execution-console layout

**Files:**
- Modify: `apps/web/src/workspace/OrganizationOverview.tsx`
- Modify: `apps/web/src/workspace/TodayWork.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/workspace/OrganizationOverview.test.tsx`
- Modify: `apps/web/src/workspace/TodayWork.test.tsx`

- [x] **Step 1: Add failing UI tests for the approved layout**

Cover four organization KPI values, project risk/progress rows, personal queue groups, current-organization reload behavior, and permission-gated management links. Use the existing test fixtures and `messageEvent` listener rather than asserting raw errors.

- [x] **Step 2: Run the UI tests and confirm missing assertions fail**

Run:

```bash
pnpm vitest run --fileParallelism=false apps/web/src/app.test.tsx apps/web/src/workspace/OrganizationOverview.test.tsx apps/web/src/workspace/TodayWork.test.tsx
```

- [x] **Step 3: Implement the minimal approved layout**

Keep the existing overview response shape and render: header/refresh, four KPI actions, project health list, weekly cadence, status distribution, and personal work queues. Keep current organization selection in `WorkspacePage`; do not add a second selector. Render admin-only links only when the existing platform/organization permission data allows them.

- [x] **Step 4: Add responsive styles and neutral empty states**

Use the existing workbench palette and CSS conventions. Preserve full-width behavior, compact cards, keyboard focus, and readable mobile wrapping. Do not add decorative dashboard cards unrelated to execution decisions.

- [x] **Step 5: Run the focused UI tests and build**

Run:

```bash
pnpm vitest run --fileParallelism=false apps/web/src/app.test.tsx apps/web/src/workspace/OrganizationOverview.test.tsx apps/web/src/workspace/TodayWork.test.tsx
pnpm --filter @vibeplan/web build
```

Expected: tests and build pass.

### Task 4: Verify local and production deployment paths

**Files:**
- Modify only if required: `deploy/server/README.md`, `deploy/server/deploy.sh`, `deploy/server/docker-compose.yml`, `docker/nginx.conf`
- Test: release/deployment verification commands

- [x] **Step 1: Verify the local API exposes the two routes**

Start the existing local stack with the repository script, then check `/health` and `/version`. Use an authenticated browser/session or API test for the organization routes; do not treat an unauthenticated 401 as a route failure.

- [x] **Step 2: Verify the Web proxy target**

Confirm Vite development proxy uses `/api` and production Nginx strips `/api/` exactly once when proxying to `api:4000`. Confirm the Compose `api` service is the same release version reported by `/version`.

- [ ] **Step 3: Verify the production deployment command**

Run the documented versioned deployment command with the current image tag, then run:

```bash
scripts/verify-release.sh VERSION https://vibeplan.szxinjin.cn/api
```

Expected: health is healthy, API version/build commit match the requested release, and the Web container depends on the healthy API container.

- [x] **Step 4: Run the full verification suite**

Run:

```bash
pnpm vitest run --fileParallelism=false apps/web/src
pnpm lint
pnpm build
git diff --check
```

Expected: all tests, TypeScript checks, builds, and whitespace checks pass.

### Task 5: Record delivery evidence

**Files:**
- Modify: the authorized `.vibe` task record only if a task ID is supplied for this work

- [x] **Step 1: Record changed files and exact verification commands**

Include API route checks, Web tests, lint, build, release verification output, and any remaining deployment risk. Do not claim the online route is fixed until the running `/version` confirms the newly published API image.

- [x] **Step 2: Leave final acceptance in review**

## Implementation Evidence (2026-10-24)

- API contract: `apps/api/src/app.test.ts`, 17 tests passed with the local `.env` database.
- Web error handling and workbench: 19 Web test files, 113 tests passed.
- Static checks: `pnpm lint`, `pnpm build`, `bash -n scripts/verify-release.sh`, and `git diff --check` passed.
- Local runtime: `GET http://localhost:4000/health` returned `{ "status": "ok" }`; `GET /version` returned protocol version 1 and the organization-workbench capabilities.
- Deployment boundary: production verification is still pending. Run `scripts/verify-release.sh VERSION https://vibeplan.szxinjin.cn/api` only after the matching API/Web images are deployed; a local pass does not prove the online 404 is fixed.
- Permission probe: `/admin/me` treats the expected non-admin 403 as a silent capability check, while unexpected API failures still use the global MessageCenter.
- Type consistency: password-reset token updates now match the `email_tokens` schema, so the workspace TypeScript check is clean.
- Local proxy: Vite now strips `/api` before forwarding to the Fastify development server, matching the production Nginx route. With `VITE_API_PROXY_TARGET=http://localhost:4000`, `/api/health` returns 200 and protected workbench endpoints return 401 when unauthenticated.

The implementation is ready for user acceptance after local and deployment checks; do not mark a Vibe Plan task done without acceptance evidence and reviewer confirmation.
