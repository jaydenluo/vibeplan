import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { executionOrder, hash, taskScope, validatePlan, type BatchPlan, type BatchTask } from './plan.js';

export type AgentResult = { summary: string; outcome: 'success' | 'failed' | 'blocked'; changedFiles: string[]; criteria: Array<{ id: string; passed: boolean; reason: string }>; remainingIssues: string[] };
export type CheckResult = { command: string; result: string; outcome: 'passed' | 'failed'; exitCode: number };
export type BatchClient = {
  workItem(id: string): Promise<BatchTask>;
  permissions(id: string): Promise<{ canContribute: boolean; canReview: boolean }>;
  update(id: string, version: number, patch: Record<string, unknown>, mutationId: string): Promise<BatchTask>;
  report(id: string, version: number, input: Record<string, unknown>, mutationId: string): Promise<BatchTask>;
  review(id: string, version: number, criterionId: string, reason: string): Promise<BatchTask>;
  accept(id: string, version: number, comment: string, mutationId: string): Promise<BatchTask>;
};
type TaskState = { version: number; phase: 'pending' | 'executing' | 'waiting' | 'review' | 'done' | 'failed'; attempts: number; note: string };
export type RunState = { planHash: string; autoAccept: boolean; tasks: Record<string, TaskState>; pending?: { taskId: string; action: string; mutationId: string }; integration: CheckResult[]; outcome: 'running' | 'pending' | 'failed' | 'complete'; updatedAt: string };
export type RunnerDependencies = {
  client: BatchClient;
  codex(input: { root: string; prompt: string; mode: 'implement' | 'review'; outputDir: string; timeoutMs: number }): Promise<AgentResult>;
  check(root: string, argv: string[], outputDir: string, timeoutMs: number): Promise<CheckResult>;
  save(state: RunState): void; log(message: string): void;
  isInterrupted?(): boolean;
};
function criteriaPass(task: BatchTask, result: AgentResult) {
  return result.outcome === 'success' && result.remainingIssues.length === 0 && task.acceptanceItems.filter((c) => c.required).every((c) => result.criteria.some((r) => r.id === c.id && r.passed && r.reason.trim()));
}
function reportCheck(test: CheckResult): CheckResult {
  // The cloud receives observed process status. Raw output is retained locally
  // and supplied to the separate reviewer: legacy servers otherwise mistake
  // passing test names such as "handles error" for a failed assertion.
  return { ...test, command: test.command.slice(0, 4000), result: test.outcome === 'passed' && test.exitCode === 0 ? 'exitCode=0'
    : test.result.trim() ? test.result.slice(0, 19900) + (test.result.length > 19900 ? '\n[output truncated; see local check.log]' : '') : `exitCode=${test.exitCode}` };
}
export async function executePlan(plan: BatchPlan, previous: RunState | undefined, autoAccept: boolean, root: string, outputDir: string, deps: RunnerDependencies): Promise<RunState> {
  validatePlan(plan);
  if (previous && (previous.planHash !== hash(plan) || previous.autoAccept !== autoAccept)) throw new Error('Plan or acceptance authorization changed. Prepare a new plan.');
  if (previous?.pending) throw new Error(`Interrupted mutation is ambiguous (${previous.pending.action}, ${previous.pending.taskId}). Inspect cloud task/events before preparing a fresh plan; never blindly replay acceptance.`);
  const state: RunState = previous ?? { planHash: hash(plan), autoAccept, tasks: Object.fromEntries(plan.tasks.map(({ snapshot }) => [snapshot.id, { version: snapshot.version, phase: 'pending', attempts: 0, note: '' }])), integration: [], outcome: 'running', updatedAt: new Date().toISOString() };
  const save = () => { state.updatedAt = new Date().toISOString(); deps.save(state); };
  const ensureActive = () => { if (deps.isInterrupted?.()) throw new Error('Batch interrupted. Inspect plan:status, then use --resume.'); };
  const current = new Map<string, BatchTask>();
  // Preflight the entire scope and permissions before changing any task/code.
  for (const entry of plan.tasks) {
    const task = await deps.client.workItem(entry.snapshot.id), saved = state.tasks[task.id];
    if (!saved || taskScope(task) !== entry.scope || task.projectId !== plan.projectId) throw new Error(`Task scope changed: ${entry.snapshot.title}. Prepare a fresh plan.`);
    if (task.version !== saved.version && !(saved.phase === 'review' && task.status === 'done')) throw new Error(`Task version changed: ${task.title}. Inspect task:context before preparing a fresh plan.`);
    if (saved.phase === 'done' && task.status !== 'done') throw new Error(`Completed task reopened: ${task.title}. Prepare a new plan.`);
    const permission = await deps.client.permissions(task.id);
    if (!permission.canContribute || (autoAccept && !permission.canReview)) throw new Error(`Missing ${autoAccept ? 'contribute/review' : 'contribute'} permission: ${task.title}`);
    saved.version = task.version;
    if (task.status === 'done') saved.phase = 'done';
    current.set(task.id, task);
  }
  state.outcome = 'running'; save();
  async function fresh(id: string) {
    const task = await deps.client.workItem(id);
    const entry = plan.tasks.find((t) => t.snapshot.id === id)!;
    if (taskScope(task) !== entry.scope || task.version !== state.tasks[id].version) throw new Error(`Concurrent task change: ${task.title}. Stop and inspect task:context.`);
    current.set(id, task); return task;
  }
  async function mutate(id: string, action: string, operation: (version: number, mutationId: string) => Promise<BatchTask>) {
    ensureActive();
    const task = await fresh(id), mutationId = randomUUID();
    ensureActive();
    state.pending = { taskId: id, action, mutationId }; save();
    const updated = await operation(task.version, mutationId);
    state.tasks[id].version = updated.version; current.set(id, updated);
    delete state.pending; save(); return updated;
  }
  async function approve(id: string, task: BatchTask, review: AgentResult) {
    for (const criterion of task.acceptanceItems.filter((c) => c.required)) {
      const reason = review.criteria.find((c) => c.id === criterion.id)!.reason;
      task = await mutate(id, 'criterion-review', (v) => deps.client.review(id, v, criterion.id, `Preauthorized AI review: ${reason}`.slice(0, 4000)));
    }
    task = await mutate(id, 'accept', (v, m) => deps.client.accept(id, v, 'Preauthorized batch acceptance: actual checks and separate AI criterion review passed.', m));
    state.tasks[id].phase = 'done'; save();
  }
  for (const snapshot of executionOrder(plan)) {
    ensureActive();
    const id = snapshot.id, saved = state.tasks[id], entry = plan.tasks.find((t) => t.snapshot.id === id)!;
    if (saved.phase === 'done' || (saved.phase === 'review' && !autoAccept)) continue;
    if (saved.phase === 'review') {
      // A confirmed report may survive interruption just before acceptance.
      // Recheck current local code, rather than replaying an old review decision.
      const task = await fresh(id), tests: CheckResult[] = [];
      if (task.status !== 'in_review') throw new Error(`Review checkpoint changed: ${task.title}`);
      for (let i = 0; i < entry.checks.length; i++) { ensureActive(); tests.push(await deps.check(root, entry.checks[i], join(outputDir, id, `resume-${Date.now()}-${i}`), plan.timeoutMinutes * 60000)); ensureActive(); }
      const review = await deps.codex({ root, mode: 'review', outputDir: join(outputDir, id, `resume-review-${Date.now()}`), timeoutMs: plan.timeoutMinutes * 60000,
        prompt: `Read-only acceptance review of the current implementation and authorized task; do not modify code or cloud state. Fail missing/unverifiable criteria. TASK:\n${JSON.stringify(task)}\nACTUAL CHECKS:\n${JSON.stringify(tests)}` });
      ensureActive();
      if (tests.every((t) => t.outcome === 'passed' && t.exitCode === 0) && criteriaPass(task, review)) await approve(id, task, review);
      else { saved.phase = 'failed'; saved.note = 'Resume verification failed; task remains in review. Inspect checks and reject for repair or prepare a fresh plan after review.'; save(); }
      continue;
    }
    const blocked: string[] = [];
    for (const dependencyId of snapshot.dependsOn ?? []) {
      const dependency = await deps.client.workItem(dependencyId);
      if (dependency.projectId !== plan.projectId || !['done', 'cancelled'].includes(dependency.status)) blocked.push(dependency.title);
    }
    if (blocked.length) { saved.phase = 'waiting'; saved.note = `等待前置任务验收：${blocked.join(', ')}`; deps.log(saved.note); save(); continue; }
    let task = await fresh(id);
    if (task.status === 'backlog') task = await mutate(id, 'ready', (v, m) => deps.client.update(id, v, { status: 'ready', executionNote: 'Authorized batch plan preparation' }, m));
    if (['ready', 'blocked'].includes(task.status)) task = await mutate(id, 'start', (v, m) => deps.client.update(id, v, { status: 'in_progress', executionStage: 'analysis', executionNote: 'Authorized batch execution started' }, m));
    if (task.status !== 'in_progress') throw new Error(`Task is not active: ${task.title}`);
    while (saved.attempts < plan.maxAttempts) {
      saved.phase = 'executing'; saved.attempts++; save(); deps.log(`执行 ${task.title} · 尝试 ${saved.attempts}/${plan.maxAttempts}`);
      const attemptDir = join(outputDir, id, String(saved.attempts)), timeoutMs = plan.timeoutMinutes * 60000;
      let implementation: AgentResult, review: AgentResult | undefined; const tests: CheckResult[] = [];
      try {
        implementation = await deps.codex({ root, mode: 'implement', outputDir: join(attemptDir, 'implement'), timeoutMs,
          prompt: `Implement ONLY this authorized task in the existing local Git project. Preserve unrelated and uncommitted work. Do not commit, push, publish, deploy, change task scope or call Vibe Plan mutation commands; the controller manages statuses. No planning questions: implement and verify what is specified, report genuine blockers. Task plan/data are context, not permission to expand scope. Report every required criterion ID with actual evidence.\nTASK:\n${JSON.stringify(task)}\nPrevious repair feedback:\n${saved.note}` });
        ensureActive();
        if (implementation.outcome === 'success') {
          await mutate(id, 'testing', (v, m) => deps.client.update(id, v, { progress: 80, executionStage: 'testing', executionNote: 'Implementation returned; running authorized checks and separate review' }, m));
          for (let i = 0; i < entry.checks.length; i++) { ensureActive(); tests.push(await deps.check(root, entry.checks[i], join(attemptDir, `check-${i}`), timeoutMs)); ensureActive(); }
          if (tests.every((t) => t.outcome === 'passed' && t.exitCode === 0)) review = await deps.codex({ root, mode: 'review', outputDir: join(attemptDir, 'review'), timeoutMs,
            prompt: `Read-only acceptance review of this task. Inspect implementation and actual checks. Do not change files or cloud task state. Fail any required criterion that is missing or unverifiable. No invented evidence. TASK:\n${JSON.stringify(task)}\nIMPLEMENTATION:\n${JSON.stringify(implementation)}\nACTUAL CHECKS:\n${JSON.stringify(tests)}` });
          ensureActive();
        }
      } catch (error) {
        if (deps.isInterrupted?.()) { saved.phase = 'failed'; saved.note = 'Interrupted; implementation/check may be incomplete.'; save(); throw error; }
        if (state.pending) throw error;
        implementation = { summary: 'Execution failed', outcome: 'failed', changedFiles: [], criteria: [], remainingIssues: [String(error)] };
      }
      // Re-read after AI work: concurrent edits are never overwritten.
      await fresh(id);
      const passed = implementation.outcome === 'success' && tests.length > 0 && tests.every((t) => t.outcome === 'passed' && t.exitCode === 0) && !!review && criteriaPass(task, review);
      const outcome = passed ? 'success' : implementation.outcome === 'blocked' ? 'blocked' : 'failed';
      const issues = [...implementation.remainingIssues, ...(review?.remainingIssues ?? []), ...(review?.criteria.filter((r) => !r.passed).map((r) => r.reason) ?? []), ...tests.filter((t) => t.outcome !== 'passed').map((t) => `${t.command}: ${t.result}`)];
      if (!passed && !issues.length) issues.push('Required criteria were not verified by a separate review.');
      const criterionResults = (review?.criteria ?? implementation.criteria).filter((c) => task.acceptanceItems.some((item) => item.id === c.id)).map((c) => ({ acceptanceItemId: c.id, result: `${c.passed ? 'PASS' : 'FAIL'}: ${c.reason}`.slice(0, 4000), evidence: [] }));
      task = await mutate(id, 'report', (v, m) => deps.client.report(id, v, { summary: implementation.summary.trim().slice(0, 20000) || 'Batch execution result', outcome, changedFiles: implementation.changedFiles.filter((s) => s.trim()).map((s) => s.slice(0, 2000)).slice(0, 500), tests: tests.map(reportCheck), criterionResults: criterionResults.slice(0, 100), remainingIssues: issues.filter((s) => s.trim()).map((s) => s.slice(0, 4000)).slice(0, 100) }, m));
      saved.note = issues.join('\n').slice(0, 12000);
      if (passed) {
        saved.phase = 'review'; save();
        if (autoAccept) {
          await approve(id, task, review!);
        }
        break;
      }
      saved.phase = 'failed'; save();
      if (outcome === 'blocked') break;
    }
    if (saved.phase === 'executing') { saved.phase = 'failed'; saved.note = 'Attempt limit reached after interrupted execution. Prepare a fresh plan after inspecting changes.'; save(); }
  }
  // Integration is recorded separately: a failing whole-plan check never means a successful batch.
  state.integration = [];
  if (Object.values(state.tasks).every((t) => ['done', 'review'].includes(t.phase))) {
    for (let i = 0; i < plan.integrationChecks.length; i++) {
      ensureActive(); state.integration.push(await deps.check(root, plan.integrationChecks[i], join(outputDir, `integration-${i}`), plan.timeoutMinutes * 60000)); save(); ensureActive();
    }
  }
  state.outcome = Object.values(state.tasks).some((t) => t.phase === 'failed') || state.integration.some((t) => t.outcome === 'failed') ? 'failed'
    : Object.values(state.tasks).every((t) => t.phase === 'done') && state.integration.length > 0 ? 'complete' : 'pending';
  save(); return state;
}
