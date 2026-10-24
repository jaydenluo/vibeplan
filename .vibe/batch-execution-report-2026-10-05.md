# Batch execution implementation report

Status: implemented and verified locally. No cloud task ID was assigned; no cloud status update, npm publication or deployment was performed.

## Delivered

- Project management “执行计划” modal selects unfinished leaf tasks and copies a literal, safely quoted preparation command. Test argv is explicit; there is no assumed package manager or browser-to-local execution claim.
- `plan:prepare` freezes cloud task scope/plans/criteria/dependencies and the current project, server and authenticated actor. Existing manifests are never overwritten.
- `plan:run --approve` drives the installed, authenticated Codex CLI locally, serially in dependency order. Implementation uses workspace-write; separate acceptance review uses read-only. Approved check argv runs without a shell, with actual exit codes, bounded time/output and persisted logs.
- Default successful delivery enters review. `--auto-accept` requires explicit authorization and existing reviewer permissions; every required criterion must be verified by separate review before criterion reviews and final acceptance. Dependencies wait for actual predecessor acceptance.
- Scope/version changes stop execution. Checkpoints, an exclusive project lock, bounded attempts (default 2, allowed 1–3), `plan:status`, explicit `--resume`, and interruption handling retain progress. Ambiguous remote mutations are never blindly replayed.
- Resume from a confirmed autoaccept review checkpoint reruns checks/review before acceptance, without reimplementing. API operations time out after 20 seconds. Local status does not require sign-in.
- Per-task acceptance and whole-plan integration results are separate. Integration failure makes the batch failed even when individual tasks were previously accepted.
- Distributed Skill, local managed guidance and Chinese/English user documentation describe authorization, execution, checks, recovery and publication boundaries.

## Changed files

`apps/cli/src/batch/{plan,runner,executor}.ts` and tests; `apps/cli/src/commands/plan.ts`; CLI command wiring; `apps/web/src/workspace/BatchPlanModal.tsx` and tests; project management page; styles; `tests/integration/batch-execution.test.ts`; package verification script; `.gitignore`; template Skill; bilingual guides/readmes; local instructions; implementation plan.

## Verification

- Full isolated database suite: 298 tests across 49 files passed.
- `pnpm lint`: passed for all workspaces.
- `pnpm build`: passed. Subsequent CLI changes were rebuilt by package verification.
- Existing E2E flows: 3 passed (native refresh, packed CLI, task lifecycle/browser refresh).
- Packed CLI installation: passed, all three plan commands and batch modules included; matching templates, Skill upgrade preservation and version checks passed.
- Actual-service integration: two-task dependency chain with genuine Node subprocess checks, reports, criterion review and approval in the isolated test database.
- Executor tests spawn fake Codex processes to verify arguments/schema/auth environment/timeouts/interruption; no real AI code execution against a user project was performed for testing.
- `git diff --check`: passed. Generated Skill was validated with skill-creator quick_validate.

## Operational limits / remaining work

- Publish a new CLI/templates version and updated web image before registry/cloud users receive this feature. This change leaves package versions at 0.1.9 and does not replace globally installed Skills.
- Install/authenticate Codex CLI and bind/authenticate Vibe Plan locally before execution. Existing task plans and criteria must be populated before authorization. Parent containers are excluded; dependencies outside the selected plan must already be done/cancelled or wait for acceptance.
- Human-review mode pauses dependent tasks until acceptance; rerun the same authorized command with `--resume`. Preserve the original `--auto-accept` option for automatic mode.
- Failed/exhausted work, changed scope, uncertain mutation results and integration failures require inspection. This version does not automatically repair an already accepted task after a later whole-plan integration failure.
- Cloud successful test evidence contains actual command/exit status. Detailed bounded output remains in local logs and is provided to the reviewer; this avoids legacy text heuristics misreading passing test names. No automatic Git commit, push, deployment or fabricated hours/evidence.
- POSIX process-group termination is tested. Windows currently terminates the immediate child only.

Codex execution reference: https://developers.openai.com/codex/noninteractive/
