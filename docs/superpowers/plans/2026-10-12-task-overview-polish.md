# Task Overview Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task overview tab easier to scan by creating a clear metric header, readable content sections, and a restrained type hierarchy without changing API behavior.

**Architecture:** Keep `TaskSummary`, `TaskHealthPanel`, and `TaskScheduleComparison` as the existing overview units. Add semantic overview classes and metric markup in the React components, then style those classes in the existing stylesheet so the detail panel remains internally scrollable and responsive.

**Tech Stack:** React, TypeScript, CSS, Vitest, Vite.

---

### Task 1: Lock the overview structure with tests

**Files:**
- Modify: `apps/web/src/workspace/ProjectTaskNavigation.test.tsx`
- Modify: `apps/web/src/styles.test.ts`

- [x] **Step 1: Add overview assertions** for the summary metric labels, overview sections, and new style hooks.
- [x] **Step 2: Run the focused tests** and confirm they fail because the new structure is not present.

### Task 2: Reshape overview content

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx:600`
- Modify: `apps/web/src/workspace/TaskHealthPanel.tsx`
- Modify: `apps/web/src/workspace/ProjectAnalytics.tsx:91`

- [x] **Step 1: Add a compact metric strip** to `TaskSummary` using existing task fields only.
- [x] **Step 2: Add semantic section headings and supporting copy** for description, health, and schedule comparison.
- [x] **Step 3: Preserve existing report, acceptance, empty, and history content.**

### Task 3: Apply visual hierarchy and responsive styling

**Files:**
- Modify: `apps/web/src/styles.css:197-258`

- [x] **Step 1: Style overview metrics** with restrained contrast, tabular numbers, and clear labels.
- [x] **Step 2: Style overview sections** with compact borders, section eyebrows, readable body line-height, and consistent font sizes.
- [x] **Step 3: Add mobile layout rules** so metric cards collapse to two columns and then one column without horizontal overflow.

### Task 4: Verify the implementation

**Files:**
- No additional files.

- [x] **Step 1: Run focused and related Vitest suites.**
- [x] **Step 2: Run the Web production build.**
- [x] **Step 3: Run `vibeplan check` and `git diff --check`.**
