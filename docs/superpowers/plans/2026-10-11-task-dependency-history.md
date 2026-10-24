# 任务依赖与变更历史优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将任务详情的“依赖与历史”Tab 改造成可快速判断阻塞状态、编辑依赖并追溯变更的双区域工作面板。

**Architecture:** 保持现有 API 和事件模型不变，在 `ProjectManagementPage.tsx` 中把依赖展示改为任务行和搜索选择器，把 `TaskHistory` 拆成带分类筛选和展开状态的时间线。复用当前项目任务列表、任务选择回调和 `task-support-panel` 样式体系，新增局部 CSS 与行为测试。

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS。

---

### Task 1: 依赖关系面板

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx:490-501`
- Modify: `apps/web/src/styles.css` dependency/history styles near `.task-support-panel`
- Test: `apps/web/src/app.test.tsx`

- [x] **Step 1: Write failing tests**

覆盖依赖行展示状态、进度、负责人和阻塞文案；添加依赖按钮打开选择器；选择后保存调用现有 `PUT /work-items/:id/dependencies`；点击依赖行切换任务。

- [x] **Step 2: Run the focused test**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx -t 'dependency'`

Expected: FAIL because the current native multi-select does not expose dependency task rows or an add-dependency selector.

- [x] **Step 3: Implement the minimal dependency UI**

Introduce `onSelectTask` to `TaskDependenciesPanel`, derive selected dependency objects from `items`, render a summary and rows, and replace the native multi-select with an “添加依赖” toggle plus a single-select list of candidates. Keep the existing save payload `{ dependsOn: selected }`, show `阻塞` when a dependency is not `done`, and call `onSelectTask(candidate)` from each row.

- [x] **Step 4: Add dependency layout styles**

Add compact dependency summary, row grid, status badge, blocker badge, selector panel, and bounded internal scrolling. Keep rows readable on narrow screens with a single-column media rule.

- [x] **Step 5: Run focused tests and build**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx -t 'dependency'`

Expected: PASS.

### Task 2: History timeline and filtering

**Files:**
- Modify: `apps/web/src/workspace/TaskEvidencePanels.tsx:1-50`
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx:452`
- Modify: `apps/web/src/styles.css` history styles
- Test: `apps/web/src/workspace/TaskEvidencePanels.test.tsx`

- [x] **Step 1: Write failing tests**

Assert history renders newest first, has filters for all/field/report/acceptance/work-log, filters records by category, and expands a collapsed record to show detailed changes.

- [x] **Step 2: Run the focused test**

Run: `pnpm exec vitest run apps/web/src/workspace/TaskEvidencePanels.test.tsx -t 'history'`

Expected: FAIL because `TaskHistory` currently renders a static ordered list without filters or expansion.

- [x] **Step 3: Implement history classification and timeline**

Add a `HistoryFilter` union, classify events by action, keep reverse chronological order, add filter buttons with `aria-pressed`, and track expanded event IDs. Each event should show category, actor, timestamp, concise summary, and expandable existing details (`changes`, reason, stage, note, comment).

- [x] **Step 4: Add timeline styles**

Add horizontal filter scrolling, timeline rail/node, compact event header, summary text, and expanded detail styles. Limit history height and enable internal scrolling.

- [x] **Step 5: Run focused tests**

Run: `pnpm exec vitest run apps/web/src/workspace/TaskEvidencePanels.test.tsx -t 'history'`

Expected: PASS.

### Task 3: Wire navigation and regression coverage

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx:452`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.test.ts`

- [x] **Step 1: Pass task selection into the dependency panel**

Render `TaskDependenciesPanel` with `onSelectTask={(candidate) => onUpdated(candidate)}` or the existing selection callback used by the detail view, preserving URL/task state.

- [x] **Step 2: Add integration assertions**

Verify the dependency/history Tab contains both regions, dependency selection changes the selected task, and switching to another task keeps the selected detail tab.

- [x] **Step 3: Add style assertions**

Assert dependency rows, history timeline, and internal scroll styles exist in `styles.test.ts`.

- [x] **Step 4: Run the full relevant suite**

Run: `pnpm exec vitest run apps/web/src/styles.test.ts apps/web/src/app.test.tsx apps/web/src/workspace/ProjectTaskNavigation.test.tsx apps/web/src/workspace/TaskEvidencePanels.test.tsx`

Expected: all tests pass.

### Task 4: Verification and delivery evidence

**Files:**
- Modify: `.vibe/tasks/<authorized-task>.md` only if the existing authorized task requires a progress/report update.

- [x] **Step 1: Run the Web build**

Run: `pnpm --filter @vibeplan/web build`

Expected: TypeScript and Vite build complete successfully.

- [x] **Step 2: Run project checks**

Run: `vibeplan check`

Expected: `Vibe Plan checks passed.`

- [x] **Step 3: Review the diff**

Run: `git diff --check` and inspect only the dependency/history files and tests changed by this plan.

- [x] **Step 4: Report remaining issue**

Keep the task in review until the user verifies the dependency rows, selector, history filters, and expandable timeline in the browser.
