# Organization and Project Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add organization/team invitations and approval workflows, project creation, and a multi-page workspace navigation.

**Architecture:** Extend the existing PostgreSQL access layer with organization invitations and team join requests. Expose scoped REST endpoints through `AccessService`, then replace the single workspace view with a sidebar shell and focused organization, project, approval, and task pages.

**Tech Stack:** Fastify, Drizzle PostgreSQL, Zod, React, Vitest, TypeScript.

---

### Task 1: Add invitation and join-request persistence

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Test: `apps/api/src/modules/access/access.test.ts`

- [ ] Add `organizationInvitations` and `teamJoinRequests` tables with unique pending constraints represented by indexes and foreign keys to users, organizations, and teams.
- [ ] Extend migration SQL with matching tables and indexes.
- [ ] Add failing repository assertions for creating, listing, approving, and rejecting pending records.
- [ ] Run the access test against the local PostgreSQL database and confirm the new assertions fail before service methods exist.

### Task 2: Implement scoped membership and approval services

**Files:**
- Modify: `apps/api/src/modules/access/service.ts`
- Modify: `apps/api/src/modules/access/access.test.ts`

- [ ] Implement organization/team/project member listing and invitation creation for organization admins and team leads.
- [ ] Implement current-user pending item listing, invitation acceptance/rejection, team join-request creation, and admin approval/rejection.
- [ ] Return `NOT_FOUND` for inaccessible organization/team/project records and `FORBIDDEN` for insufficient roles.
- [ ] Run the focused access tests until all invitation and approval cases pass.

### Task 3: Add access REST endpoints

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] Add routes for member lists, organization invitations, team join requests, pending items, and project creation.
- [ ] Validate email, slugs, and UUID/path inputs with Zod and preserve existing error mappings.
- [ ] Add HTTP tests covering an authenticated admin creating an organization/team/project and approving a request.

### Task 4: Build the multi-page workspace shell

**Files:**
- Create: `apps/web/src/workspace/WorkspaceShell.tsx`
- Create: `apps/web/src/workspace/OrganizationPage.tsx`
- Create: `apps/web/src/workspace/ProjectsPage.tsx`
- Create: `apps/web/src/workspace/ApprovalsPage.tsx`
- Modify: `apps/web/src/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Add sidebar navigation for overview, organization/team management, projects, approvals, and current task board.
- [ ] Add organization/team creation forms, project creation form, invitation form, and approval action buttons.
- [ ] Keep task board behavior intact under the task page and preserve project/team selection context.
- [ ] Add component tests for sidebar labels and the organization/project page entry points.

### Task 5: Verify and document the workflow

**Files:**
- Modify: `README.md`

- [ ] Document organization/team/project setup, invitations, approvals, and the local development configuration.
- [ ] Run `DATABASE_URL=... pnpm test`, `pnpm lint`, `pnpm build`, and `git diff --check`.
- [ ] Confirm the local API health endpoint and Web URL are reachable.
