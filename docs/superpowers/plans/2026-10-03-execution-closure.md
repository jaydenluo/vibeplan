# VibePlan Execution Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete detailed plans, explainable progress and risks, dependency/milestone health, and contribution evidence across API, Web, CLI, and documentation.

**Architecture:** Extend the existing Drizzle/Postgres work-item model with nullable additive fields and focused relation tables. Keep derived progress/risk/contribution calculations in pure service helpers, expose them through existing project/task endpoints, render read-only plan Markdown in Web, and write a separate `.plan.md` mirror from the CLI daemon.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, PostgreSQL, React, Vitest, pnpm workspace.

---

### Task 1: Add additive planning and work-log data model

**Files:**
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `packages/core/src/work-items.ts`
- Test: `apps/api/src/db/schema.test.ts`

- [ ] **Step 1: Write failing schema assertions** for plan Markdown, actual hours, work logs, milestones, and task-milestone relations.
- [ ] **Step 2: Run the schema test and verify it fails** because the fields/tables do not exist.
- [ ] **Step 3: Add additive migrations and Drizzle tables** with nullable/default-safe fields and cascade deletes.
- [ ] **Step 4: Extend shared work-item validation types** with plan and actual-hours fields.
- [ ] **Step 5: Run the schema test and verify it passes.**

### Task 2: Implement plan Markdown and work-log APIs

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/modules/work-items/work-items.test.ts`

- [ ] **Step 1: Add failing API tests** for creating/updating a plan, reading it, adding a work log, and enforcing contributor permissions/version checks.
- [ ] **Step 2: Run only those tests and verify the expected failures.**
- [ ] **Step 3: Add validated request schemas and service methods** for plan updates and work-log creation/listing.
- [ ] **Step 4: Return plan content and work-log summaries from task/project responses.**
- [ ] **Step 5: Run the targeted API tests and verify they pass.**

### Task 3: Implement derived progress and risk calculations

**Files:**
- Create: `apps/api/src/modules/work-items/health.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/work-items/health.test.ts`
- Modify: `apps/api/src/modules/work-items/work-items.test.ts`

- [ ] **Step 1: Write failing pure-function tests** for weighted child progress, overdue, stale, and schedule-lag flags.
- [ ] **Step 2: Run the tests and verify they fail.**
- [ ] **Step 3: Implement deterministic helpers** using an injected `now` value and no database writes.
- [ ] **Step 4: Attach summaries and risk flags to task/project API responses** and add a risk filter.
- [ ] **Step 5: Run health and work-item tests and verify they pass.**

### Task 4: Implement dependencies, milestones, and project health

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Modify: `apps/api/src/modules/access/service.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/modules/work-items/work-items.test.ts`

- [ ] **Step 1: Add failing tests** for dependency CRUD, blocked task start, milestone CRUD/assignment, and health summary counts.
- [ ] **Step 2: Run the tests and verify they fail.**
- [ ] **Step 3: Implement permission-checked dependency and milestone methods** with cycle detection and clear errors.
- [ ] **Step 4: Add project health aggregation** using the derived risk helpers.
- [ ] **Step 5: Run targeted tests and verify they pass.**

### Task 5: Add Web controls and read-only plan display

**Files:**
- Modify: `apps/web/src/workspace/WorkItemCreateForm.tsx`
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/app.test.tsx`

- [ ] **Step 1: Add failing UI tests** for plan display, risk filter, dependency/ milestone controls, health summary, and work-log entry.
- [ ] **Step 2: Run the tests and verify they fail.**
- [ ] **Step 3: Add compact form fields and read-only Markdown text rendering** without `dangerouslySetInnerHTML`.
- [ ] **Step 4: Add risk indicators, blocking labels, milestone summary, and contribution filters.**
- [ ] **Step 5: Run Web tests and verify they pass.**

### Task 6: Extend CLI mirrors and documentation

**Files:**
- Modify: `apps/cli/src/sync/task-mirror.ts`
- Modify: `apps/cli/src/sync/sync.ts`
- Modify: `apps/cli/src/sync/sync.test.ts`
- Modify: `apps/cli/README.md`
- Modify: `docs/user-guide.md`
- Modify: `packages/templates/src/index.ts`

- [ ] **Step 1: Add failing sync tests** for a separate `.plan.md` file and empty plan handling.
- [ ] **Step 2: Run the sync tests and verify they fail.**
- [ ] **Step 3: Write the plan mirror atomically** next to the existing task mirror and keep daemon behavior unchanged.
- [ ] **Step 4: Document plan, risk, dependencies, work logs, and contribution workflows in Chinese and English.**
- [ ] **Step 5: Run CLI/template tests and verify they pass.**

### Task 7: Full verification and task evidence

**Files:**
- Modify: `.vibe/tasks/5d604d1d-10bd-4c34-af90-16a77f62ae55.md`
- Modify: `.vibe/tasks/a1a3d809-fcd9-4de2-9197-ee005e6bfaca.md`
- Modify: `.vibe/tasks/66bd18e6-93d2-4479-8d67-d95b6898e8ac.md`
- Modify: `.vibe/tasks/5a1215dc-6aa8-4a12-9eac-39fa15b9c700.md`

- [ ] **Step 1: Run `vibeplan check`.**
- [ ] **Step 2: Run the complete test suite against the project test PostgreSQL container.**
- [ ] **Step 3: Run `pnpm lint` and `pnpm -r build`.**
- [ ] **Step 4: Record changed files, tests, and remaining issues in the task mirrors.**
- [ ] **Step 5: Report evidence without marking remote tasks done; user acceptance remains required.**
