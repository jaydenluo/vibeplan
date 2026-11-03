# 免费版套餐合并 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the personal plan and make free organizations support three members and fifty aggregate projects.

**Architecture:** Keep `free` as the canonical plan code and update the backend catalog as the source of entitlement rules. Synchronize API types, Web cards, admin labels, docs and tests so no client can select the removed `personal` code.

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, React/Vite, Vitest.

---

### Task 1: Update the backend catalog and public plan types

**Files:** `apps/api/src/db/schema.ts`, `apps/api/src/app.ts`, `apps/api/src/modules/billing/catalog.ts`, `apps/api/src/modules/billing/entitlements.ts`

- [x] Change `BillingPlanCode` to remove `personal`.
- [x] Change `free` to name `Free`, `seatLimit: 3`, `projectLimit: 50`.
- [x] Remove `personal` from the order request Zod enum.
- [x] Confirm entitlement calculations still use `free` for aggregate project counting and the new seat limit.

### Task 2: Update backend billing tests and fixtures

**Files:** `apps/api/src/modules/billing/catalog.test.ts`, `apps/api/src/modules/billing/orders.test.ts`, `apps/api/src/modules/billing/entitlements.test.ts`, `apps/api/src/modules/access/access.test.ts`, `apps/api/src/db/schema.test.ts`

- [x] Replace personal-plan expectations with free-plan expectations.
- [x] Add assertions that the catalog has no `personal` key, free has 3 seats and 50 projects, and team orders remain unchanged.
- [x] Add a free organization entitlement test proving three members are allowed and the fourth is denied.

### Task 3: Synchronize Web billing and admin display

**Files:** `apps/web/src/api/client.ts`, `apps/web/src/workspace/BillingPage.tsx`, `apps/web/src/workspace/AdminConsolePage.tsx`

- [x] Remove `personal` from `BillingPlanCode` and the billing card list.
- [x] Change the free card label and description to “免费版”, three members and 50 aggregate projects.
- [x] Remove personal-only checkout/renewal test paths and update admin plan labels and filters.

### Task 4: Update documentation and run verification

**Files:** `docs/billing.md`, `docs/superpowers/specs/2026-11-03-free-plan-merge-design.md`, `docs/superpowers/plans/2026-11-03-free-plan-merge.md`

- [x] Rewrite the plan table and free-plan rules.
- [x] Search the repository for stale user-facing personal-plan references, excluding historical changelog context if any.
- [x] Run focused billing/Web tests, `pnpm lint`, `pnpm build`, and `git diff --check`.
