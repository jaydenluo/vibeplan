# Batch plan execution implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Execute a frozen, explicitly authorized project plan locally with Codex, dependency ordering, genuine check results and optional reviewer-authorized acceptance.

**Architecture:** A local JSON manifest snapshots task scope and approved check argv. A serial controller invokes workspace-write Codex for implementation and read-only Codex for review, persists checkpoints, and calls existing versioned APIs. The web modal copies preparation commands; it cannot execute code on a user's computer.

**Tech Stack:** TypeScript, Node child_process, Commander, React, Vitest, existing Vibe Plan APIs.

## 1. Execution adapter
- [x] Write failing tests for subprocess failure, timeout, malformed JSON and failed verification.
- [x] Add `apps/cli/src/batch/executor.ts`: `runCodex({root,prompt,mode,outputDir,timeoutMs})` returns `{summary,outcome,changedFiles,criteria:[{id,passed,reason}],remainingIssues}`. Mode is implement or review. Enforce structured output, bounded process lifetime, stream logs, preserve saved CLI authentication. Never bypass sandbox or commit/push/deploy.
- [x] Add `runCheck(root, argv, outputDir, timeoutMs)` for user-approved local test commands, returning actual command/result/outcome/exitCode. No shell interpolation.

## 2. Manifest and controller
- [x] Write dependency and controller tests: cycles, external dependency, scope drift, missing plan/checks, failed evidence, reviewer permission and resume without rerunning completed tasks.
- [x] Add `apps/cli/src/batch/plan.ts`, `runner.ts`, `commands/plan.ts`. Prepare snapshots nonterminal leaf tasks, supports explicit IDs. Manifest includes task checks and integration checks; no automatic shell-command selection.
- [x] Wire `plan:prepare --task ID --check '["pnpm","test"]'`, `plan:run --file PATH --approve [--auto-accept]`, `plan:status --file PATH`. CLI verifies binding and actor, locks execution, records versioned checkpoints, rejects drift/ambiguous interrupted operations, and processes independent tasks despite failed/blocked tasks.
- [x] Human-review dependencies wait until predecessors are accepted. Autoaccept runs only after checks plus a separate review approve every required criterion. Whole-plan integration results remain distinct from per-task acceptance.

## 3. Web and guidance
- [x] Add tested compact “执行计划” button/modal, task selection and copy command with success feedback, explaining local execution and acceptance options.
- [x] Update bilingual tutorials and distributed Skill: batch authorization covers frozen scope, default human review, explicit permission-checked autoaccept exception, actual tests only, interruption/drift never blindly replay approval.

## 4. Verification and report
- [x] Run focused tests, type checking, workspace build and full isolated-db suite.
- [x] Review diff for permissions, scope and process handling; record changed files, tests and remaining limitations in `.vibe/batch-execution-report-2026-10-05.md`.

No cloud task ID has been assigned for this implementation; record local evidence, do not fabricate cloud status. No npm publication, deployment or global Skill replacement is part of this change.
