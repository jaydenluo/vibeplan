# Codex Session Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a secure first-stage bridge that lets the Web list authorized local Codex sessions, create or bind sessions, and assign a version-checked task execution to a local Agent.

**Architecture:** Add API persistence for devices, sessions, and executions. Extend the existing CLI daemon with a heartbeat/polling worker that registers bound projects and claims queued execution commands. Add a small Web session picker and execution status panel to the task detail surface. Historical desktop Codex sessions remain explicit imports; the Agent reports them only when a provider adapter can identify them.

**Tech Stack:** Fastify, Drizzle/PostgreSQL migration, Zod, existing cookie authentication, TypeScript CLI, React/Vite, Vitest.

---

### Task 1: Persist devices, sessions, executions, and commands

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Test: `apps/api/src/modules/agent/sessions.test.ts`

- [ ] Add tables with ownership, project binding, heartbeat timestamps, execution snapshot/version, idempotency keys, and command status.
- [ ] Add the same tables and indexes to the ordered SQL migration.
- [ ] Add database-level uniqueness for `(user_id, provider_session_id)` when provider ID is present and `(execution_id, event_id)`.
- [ ] Add schema tests that assert the migration creates the tables and a duplicate execution event is rejected.

### Task 2: Implement authenticated Agent/session API

**Files:**
- Create: `apps/api/src/modules/agent/service.ts`
- Create: `apps/api/src/modules/agent/routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/modules/agent/sessions.test.ts`

- [ ] Implement device registration and heartbeat using the authenticated user session.
- [ ] Implement `GET /agent/sessions`, `POST /agent/sessions`, bind/unbind, execution creation, execution status, cancellation, and event ingestion.
- [ ] Require project membership and current work-item version before creating an execution snapshot.
- [ ] Use a stable `executionId` and event idempotency key; repeated events return the existing result.
- [ ] Mark sessions offline after a 45-second heartbeat timeout in list responses.
- [ ] Reject arbitrary project paths; only accept a path already reported by the Agent for the selected device/project binding.

### Task 3: Add local Agent session polling

**Files:**
- Create: `apps/cli/src/agent/worker.ts`
- Modify: `apps/cli/src/commands/daemon.ts`
- Modify: `apps/cli/src/api-client.ts`
- Test: `apps/cli/src/agent/worker.test.ts`

- [ ] Register each bound local project and report the daemon capability and path.
- [ ] Poll for commands every two seconds with exponential backoff on network failure.
- [ ] Claim one execution command atomically before starting it, and acknowledge duplicate command delivery without rerunning it.
- [ ] For the first provider adapter, execute only the existing authorized `plan:run` path through a dedicated worker boundary; do not interpret task text as shell input.
- [ ] Send heartbeat, execution stage, log chunks, final report, and cancellation acknowledgement.
- [ ] Preserve the local execution checkpoint when the network fails and require reconciliation before uncertain replay.

### Task 4: Add Web session selection and execution status

**Files:**
- Create: `apps/web/src/workspace/CodexSessionPicker.tsx`
- Create: `apps/web/src/workspace/CodexSessionPicker.test.tsx`
- Modify: `apps/web/src/workspace/ProjectManagementPage.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Fetch and display sessions for the active project, sorted by online status and recent activity.
- [ ] Support “新建会话” and selecting an existing authorized session.
- [ ] Add an explicit “绑定已有 Codex 会话” action that creates a pending bind request instead of scanning local history.
- [ ] Create an execution from the selected task/version and show queued/running/paused/error/in-review states.
- [ ] Subscribe to execution events with polling fallback and show a cancel button.
- [ ] Keep task completion under human review; never auto-accept from the Web action.

### Task 5: Verify security, recovery, and documentation

**Files:**
- Modify: `README.md`
- Create: `docs/codex-session-bridge.md`
- Test: `apps/api/src/modules/agent/sessions.test.ts`, `apps/cli/src/agent/worker.test.ts`, `apps/web/src/workspace/CodexSessionPicker.test.tsx`

- [ ] Test cross-user and cross-project access denial, stale task version rejection, duplicate event handling, cancellation, and offline display.
- [ ] Run `pnpm lint`, focused tests, `pnpm build`, and `git diff --check`.
- [ ] Document that `vibeplan start` keeps the Agent online, that historical Codex sessions require explicit binding, and that execution ends in review.
