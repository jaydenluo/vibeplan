# Task Detail Execution Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing task detail panel into a fixed summary plus independently scrolling execution body.

**Architecture:** Keep `TaskDetailView` as the composition boundary. Add a compact summary/action header inside the existing detail scroll structure, while preserving the existing child panels and API calls. Use CSS flex constraints so only the detail body scrolls.

**Tech Stack:** React, TypeScript, CSS, Vitest, Vite.

---

### Task 1: Add the compact task summary header

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx` (`TaskDetailView`)
- Modify: `apps/web/src/styles.css` (task detail summary styles)
- Test: `apps/web/src/app.test.tsx`

- [x] Add a detail summary header containing the selected task title, priority, status, progress, assignee, due date, and the existing edit entry point.
- [x] Keep the summary outside `.task-detail-scroll` so it remains fixed with the panel heading.
- [x] Preserve the existing child panels and their API behavior.
- [x] Preserve the existing detail metadata assertions while exposing the compact summary fields.

### Task 2: Constrain detail scrolling and responsive layout

**Files:**
- Modify: `apps/web/src/styles.css` (`.task-detail-content`, `.task-detail-scroll`, responsive detail rules)
- Test: `apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

- [x] Set the detail content to a column flex layout with `min-height: 0`.
- [x] Make `.task-detail-scroll` the only vertical scrolling region.
- [x] Keep the existing two-column description/acceptance section on wide screens and collapse it below `760px`.
- [x] Verify no horizontal overflow is introduced on narrow viewports through the responsive CSS and build checks.

### Task 3: Verify the feature

**Files:**
- Test: `apps/web/src/app.test.tsx`
- Test: `apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

- [x] Run `pnpm exec vitest run apps/web/src/app.test.tsx apps/web/src/workspace/ProjectTaskNavigation.test.tsx` and confirm all tests pass.
- [x] Run `pnpm --filter @vibeplan/web build` and confirm TypeScript and Vite complete successfully.
