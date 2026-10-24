# Project Directory Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove project-management branding and provide a persistent desktop icon-rail collapse mode for the project directory.

**Architecture:** Keep collapse state local to `ProjectManagementPage` and persist it with a page-specific local-storage key. The existing directory buttons continue to select projects; a CSS modifier changes their desktop presentation to icon-only while responsive rules keep the mobile directory unchanged.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS Grid.

---

### Task 1: Cover the directory-collapse behavior

**Files:**
- Modify: `apps/web/src/workspace/ProjectTaskNavigation.test.tsx`
- Test: `apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

- [ ] **Step 1: Write a failing test for the desktop collapse control**

```tsx
it('collapses the project directory into an icon rail and restores it', async () => {
  render(<ProjectManagementPage projects={[{ id: 'one', name: '项目一', slug: 'one', teamId: 'team' }]} activeProjectId="one" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('complementary', { name: '项目目录' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '收起项目目录' }));
  expect(screen.getByRole('complementary', { name: '项目目录' }).classList.contains('collapsed')).toBe(true);
  expect(screen.getByRole('button', { name: '展开项目目录' })).toBeTruthy();
});
```

- [ ] **Step 2: Run the test and verify it fails because the toggle is absent**

Run: `pnpm exec vitest run apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

Expected: FAIL with no button named `收起项目目录`.

- [ ] **Step 3: Add the local state, toggle button, and icon-rail modifiers in `ProjectManagementPage`**

Use `vibe-plan.project-directory-collapsed` as the local-storage key. Render an `aside` class modifier and an accessible `title`/`aria-label` on every project item. Omit `project-version-mark` from the project-management header.

- [ ] **Step 4: Add desktop and mobile CSS rules in `apps/web/src/styles.css`**

Set the desktop collapsed rail to `76px`, hide directory labels only in that mode, and pin the toggle after the scrollable project list. Override it on mobile so the existing horizontal card-like list remains visible.

- [ ] **Step 5: Re-run the focused test**

Run: `pnpm exec vitest run apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

Expected: PASS.

### Task 2: Verify the management page remains buildable

**Files:**
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Run the full management-page test file**

Run: `pnpm exec vitest run apps/web/src/app.test.tsx apps/web/src/workspace/ProjectTaskNavigation.test.tsx`

Expected: PASS.

- [ ] **Step 2: Build the web application**

Run: `pnpm --filter @vibeplan/web build`

Expected: Vite build completes successfully.
