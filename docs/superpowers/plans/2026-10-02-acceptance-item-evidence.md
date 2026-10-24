# Acceptance Item Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured per-criterion acceptance records and prevent a task from completing until required criteria pass.

**Architecture:** Store the additive structured records on each work item while retaining legacy text criteria. The work-item service normalizes legacy records, owns status validation, and records reviewer metadata; the project-management detail surface calls a focused update endpoint.

**Tech Stack:** TypeScript, Fastify, Drizzle/PostgreSQL, React, Vitest.

---

### Task 1: Structured acceptance persistence

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Test: `apps/api/src/modules/work-items/work-items.test.ts`

- [ ] Write a failing service test showing that new textual criteria become unverified required acceptance items and that a failed required item prevents `done`.
- [ ] Run the focused test and confirm it fails because acceptance items are not persisted or checked.
- [ ] Add the JSONB column, migration, normalization helper, and required-item completion guard.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Criterion review endpoint

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/work-items/service.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] Write a failing API test that updates one criterion with comment and evidence URL and returns reviewer metadata.
- [ ] Run the focused test and confirm the route is absent.
- [ ] Add schema validation and a versioned criterion-review endpoint.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Task-detail review controls

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/app.test.tsx`

- [ ] Write a failing UI test that selects a criterion result, writes a comment and evidence URL, then saves it.
- [ ] Run the focused test and confirm the controls are absent.
- [ ] Add compact editable acceptance rows and use the new endpoint.
- [ ] Re-run the focused test and confirm it passes.

### Task 4: Verification and task report

**Files:**
- Modify: `.vibe/tasks/39fb496b-e4c0-44fa-95f8-54006f25730d.md`

- [ ] Run API and web focused suites, `pnpm lint`, `pnpm -r build`, and `vibeplan check`.
- [ ] Record changed files, commands, outcomes, and remaining limitations through `vibeplan task:report` after restoring the CLI session.
