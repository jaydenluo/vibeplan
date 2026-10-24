# Organization Subscription Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add organization-scoped annual plans, server-enforced free/paid entitlements, manual annual renewal, and Alipay payment verification without exposing payment secrets.

**Architecture:** Keep billing in a focused API module. `BillingService` owns the catalog, orders, Alipay provider abstraction, and subscription transitions; `EntitlementService` computes a single organization policy used by every mutation path. PostgreSQL stores immutable order snapshots, current organization subscription state, and idempotent provider notifications. The web app consumes billing summaries and payment URLs, while only verified asynchronous Alipay notifications activate subscriptions.

**Tech Stack:** TypeScript, Fastify, Drizzle schema types, postgres.js/raw idempotent migrations, React, Vitest, pnpm workspaces.

---

### Task 1: Add billing schema and configuration contract

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `.env.example`
- Modify: `apps/api/src/runtime/version.ts` only if runtime config typing is centralized there
- Test: `apps/api/src/db/schema.test.ts`

- [ ] **Step 1: Write schema migration tests** for organization subscriptions, billing orders, and provider notifications being created idempotently and for unique organization/current-subscription and provider-transaction constraints.
- [ ] **Step 2: Run the focused schema test** with `pnpm vitest run apps/api/src/db/schema.test.ts`; it should fail because the tables and migration statements do not exist.
- [ ] **Step 3: Add typed Drizzle tables** for `organizationSubscriptions`, `billingOrders`, and `billingProviderNotifications`, including plan/status enums as string unions, amount snapshots in integer cents, period/grace timestamps, scheduled downgrade fields, provider references, and notification result metadata.
- [ ] **Step 4: Add idempotent SQL** to `migrate.ts` with `create table if not exists`, `alter table ... add column if not exists`, and unique indexes matching the typed schema.
- [ ] **Step 5: Add `.env.example` billing fields**: `BILLING_PROVIDER=manual`, `ALIPAY_APP_ID`, `ALIPAY_PRIVATE_KEY`, `ALIPAY_PUBLIC_KEY`, `ALIPAY_GATEWAY`, `ALIPAY_NOTIFY_URL`, `ALIPAY_RETURN_URL`, and `ALIPAY_SELLER_ID`, with comments that private keys stay server-side.
- [ ] **Step 6: Run the focused schema and TypeScript checks** and commit as `feat: add billing persistence schema`.

### Task 2: Implement catalog, entitlement calculation, and server guards

**Files:**
- Create: `apps/api/src/modules/billing/catalog.ts`
- Create: `apps/api/src/modules/billing/entitlements.ts`
- Create: `apps/api/src/modules/billing/service.ts`
- Modify: `apps/api/src/modules/access/service.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Test: `apps/api/src/modules/billing/entitlements.test.ts`
- Test: `apps/api/src/modules/billing/service.test.ts`
- Modify: `apps/api/src/modules/access/access.test.ts`

- [ ] **Step 1: Write entitlement tests** covering free project aggregation across owned free organizations, free membership lock, paid unique seat counts across multiple teams, active/grace/expired write states, and scheduled downgrade over-seat behavior.
- [ ] **Step 2: Run the entitlement tests** with `pnpm vitest run apps/api/src/modules/billing/entitlements.test.ts`; they should fail before the service exists.
- [ ] **Step 3: Implement the immutable plan catalog** with `free`, `team_10`, `team_30`, `team_100`, `enterprise_1000`, and `custom`, prices in cents, seat limits, and unlimited project markers.
- [ ] **Step 4: Implement `EntitlementService.getOrganizationPolicy`** to load subscription state, evaluate current time against period and seven-day grace, count distinct organization memberships, count projects across the owner’s free organizations, apply scheduled plans at period end, and return stable error codes and usage data.
- [ ] **Step 5: Add write guards** to project creation, team/member/invite mutations, and work-item/project/task write methods. Reads remain unchanged. Every denial must use one of the documented billing error codes.
- [ ] **Step 6: Add tests for each guarded mutation** and verify a paid organization does not consume the owner’s free-project pool.
- [ ] **Step 7: Run API billing/access tests** with `pnpm vitest run apps/api/src/modules/billing apps/api/src/modules/access/access.test.ts` and commit as `feat: enforce organization billing entitlements`.

### Task 3: Add order service and manual provider for local development

**Files:**
- Create: `apps/api/src/modules/billing/providers/types.ts`
- Create: `apps/api/src/modules/billing/providers/manual.ts`
- Modify: `apps/api/src/modules/billing/service.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/billing/orders.test.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write order tests** for owner-only creation, server-side amount snapshots, renewal extension, duplicate notification idempotency, manual payment activation, and failed/closed order transitions.
- [ ] **Step 2: Implement a provider interface** with `createPayment`, `verifyNotification`, and `getProviderName`; the manual provider returns a local payment marker and accepts only an explicit test/admin confirmation path.
- [ ] **Step 3: Implement order creation** using the catalog rather than client prices, reject custom plans from public purchase, and persist the purchaser/organization/period snapshot.
- [ ] **Step 4: Implement transactional payment confirmation** that records the unique notification, marks the order paid, creates or extends the subscription, and applies the scheduled/active plan transition exactly once.
- [ ] **Step 5: Add API routes** for organization billing summary, order creation, order lookup, and manual confirmation in non-production mode. Require owner authorization for mutations.
- [ ] **Step 6: Run order and app tests** with `pnpm vitest run apps/api/src/modules/billing/orders.test.ts apps/api/src/app.test.ts` and commit as `feat: add billing orders and manual provider`.

### Task 4: Integrate real Alipay signing and notification verification

**Files:**
- Create: `apps/api/src/modules/billing/providers/alipay.ts`
- Modify: `apps/api/src/modules/billing/service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/modules/billing/alipay.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write deterministic Alipay tests** with fixed key fixtures for signed request generation, valid notification verification, wrong app ID/seller, amount mismatch, stale order, invalid signature, and duplicate trade number.
- [ ] **Step 2: Add the maintained Alipay SDK or a small isolated RSA adapter** using the repository’s package policy; keep all key material loaded from environment variables and never log it.
- [ ] **Step 3: Implement web-payment form generation** with server-selected order number, amount, notify URL, return URL, seller/app identifiers, and RSA2 signing.
- [ ] **Step 4: Implement `/api/billing/alipay/notify`** without user authentication, preserving the request body needed for verification, checking signature/app/seller/order/amount/trade status, and returning Alipay’s success response only after the transaction commits.
- [ ] **Step 5: Reject production startup/order creation** when `BILLING_PROVIDER=alipay` lacks any required configuration; keep `manual` available for local tests only.
- [ ] **Step 6: Run Alipay tests and the API build** with `pnpm vitest run apps/api/src/modules/billing/alipay.test.ts && pnpm --filter @vibeplan/api build`, then commit as `feat: integrate alipay payments`.

### Task 5: Build organization billing Web UI

**Files:**
- Create: `apps/web/src/workspace/BillingPage.tsx`
- Modify: `apps/web/src/workspace/OrganizationPage.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/workspace/BillingPage.test.tsx`

- [ ] **Step 1: Write UI tests** for plan/usage display, owner-only purchase controls, read-only and grace banners, payment-pending polling, and explicit limit explanations.
- [ ] **Step 2: Add API client methods** for billing summary, order creation, order lookup, and payment confirmation/return handling without placing secrets in the browser.
- [ ] **Step 3: Implement the billing page** with plan comparison, current plan/member usage/expiry, renewal and scheduled downgrade actions, recent orders, and custom enterprise contact state.
- [ ] **Step 4: Add organization navigation** and route handling; non-owners see read-only subscription information and cannot invoke billing mutations.
- [ ] **Step 5: Add disabled-action explanations** to project/member/task creation surfaces when entitlement policy denies writes.
- [ ] **Step 6: Run Web tests and build** with `pnpm vitest run apps/web/src/workspace/BillingPage.test.tsx && pnpm --filter @vibeplan/web build`, then commit as `feat: add organization billing interface`.

### Task 6: Documentation, deployment configuration, and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.md`
- Modify: `docker-compose.prod.yml`
- Create: `docs/billing.md`
- Test: `apps/api/src/modules/billing/e2e.test.ts`

- [ ] **Step 1: Write an API-level end-to-end test** in manual mode covering create order, confirm payment, refresh summary, expired/grace policy, and restored write access.
- [ ] **Step 2: Document** annual manual renewal, seven-day grace/read-only behavior, plan prices, no-invoice scope, Alipay setup, callback HTTPS routing, secret rotation, and local manual mode.
- [ ] **Step 3: Add production environment validation** to deployment documentation and compose wiring without embedding secrets or changing existing database volume behavior.
- [ ] **Step 4: Run the complete verification suite**: `vibeplan check`, `pnpm test`, `pnpm -r build`, and `git diff --check`.
- [ ] **Step 5: Review changed files for secret leakage** with `rg -n "BEGIN (RSA|PRIVATE)|ALIPAY_PRIVATE_KEY=.*[^=]" --glob '!*.example' .` and confirm no real credential appears.
- [ ] **Step 6: Commit documentation and verification as `docs: document billing deployment and renewal` and report exact test results.

## Execution Notes

- Do not modify unrelated dirty-worktree changes.
- Do not auto-commit or publish Docker/npm artifacts.
- Use the existing idempotent migration style and API test helpers.
- Keep payment activation server-side; browser return pages are informational only.
- A successful implementation leaves paid orders/subscriptions in review until the user validates a real Alipay sandbox or production notification.
