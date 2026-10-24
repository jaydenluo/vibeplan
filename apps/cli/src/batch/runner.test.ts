import { expect, it } from 'vitest';
import { makePlan, type BatchTask } from './plan.js';
import { executePlan, type BatchClient, type RunState } from './runner.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup(extra: Partial<BatchTask> = {}) {
  const task: BatchTask = { id: id(1), projectId: id(99), title: 'Build', status: 'backlog', version: 1, planMarkdown: '# Build the feature', dependsOn: [], acceptanceItems: [{ id: 'c1', text: 'Works', required: true }], ...extra };
  const tasks = new Map([[task.id, task]]); const actions: string[] = [];
  const mutate = async (key: string, version: number, patch: Record<string, unknown>) => { const t = tasks.get(key)!; expect(version).toBe(t.version); const next = { ...t, ...patch, version: version + 1 }; tasks.set(key, next); return next; };
  const client: BatchClient = {
    workItem: async (key) => tasks.get(key)!, permissions: async () => ({ canContribute: true, canReview: true }),
    update: async (key, v, patch) => { actions.push(String(patch.status ?? patch.executionStage)); return mutate(key, v, patch); },
    report: async (key, v, input) => { actions.push(`report:${input.outcome}`); return mutate(key, v, { status: input.outcome === 'success' ? 'in_review' : 'in_progress' }); },
    review: async (key, v) => { actions.push('criterion'); return mutate(key, v, {}); },
    accept: async (key, v) => { actions.push('accept'); return mutate(key, v, { status: 'done' }); },
  };
  const plan = makePlan({ projectId: id(99), actorId: id(98), server: 'https://example.com/api' }, [task], [], [['npm', 'test']]);
  const result = { summary: 'Implemented', outcome: 'success' as const, changedFiles: ['src/main.ts'], criteria: [{ id: 'c1', passed: true, reason: 'Verified behavior' }], remainingIssues: [] };
  const deps = { client, codex: async () => result, check: async () => ({ command: 'npm test', result: 'exit 0', outcome: 'passed' as const, exitCode: 0 }), save: (_s: RunState) => {}, log: (_s: string) => {} };
  return { tasks, actions, plan, deps, result };
}
it('delivers to review by default and does not autoapprove', async () => {
  const f = setup(); const state = await executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps);
  expect(state.tasks[id(1)].phase).toBe('review'); expect(f.actions).not.toContain('accept'); expect(state.outcome).toBe('pending');
});
it('requires a separate verified review and real passing tests before optional acceptance', async () => {
  const f = setup(); const state = await executePlan(f.plan, undefined, true, '/tmp', '/tmp', f.deps);
  expect(f.actions.slice(-3)).toEqual(['report:success', 'criterion', 'accept']); expect(state.outcome).toBe('complete');
});
it('never accepts failed checks even when AI claims success, and limits repairs', async () => {
  const f = setup(); let calls = 0;
  f.deps.codex = async () => { calls++; return f.result; };
  f.deps.check = async () => ({ command: 'npm test', result: 'exit 1', outcome: 'failed', exitCode: 1 }) as never;
  const state = await executePlan(f.plan, undefined, true, '/tmp', '/tmp', f.deps);
  expect(calls).toBe(2); expect(f.actions).not.toContain('accept'); expect(state.outcome).toBe('failed');
});
it('checks permissions and frozen scope before any implementation or state write', async () => {
  const f = setup(); f.deps.client.permissions = async () => ({ canContribute: true, canReview: false });
  await expect(executePlan(f.plan, undefined, true, '/tmp', '/tmp', f.deps)).rejects.toThrow('review');
  expect(f.actions).toEqual([]);
  f.tasks.set(id(1), { ...f.tasks.get(id(1))!, planMarkdown: 'Changed scope' });
  await expect(executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps)).rejects.toThrow('scope');
});
it('does not rerun reviewed work on resume and starts dependent tasks only after acceptance', async () => {
  const f = setup(); const dependent = { ...f.tasks.get(id(1))!, id: id(2), dependsOn: [id(1)] }; f.tasks.set(id(2), dependent);
  f.plan = makePlan({ projectId: id(99), actorId: id(98), server: 'https://example.com/api' }, [...f.tasks.values()], [], [['npm', 'test']]);
  const state = await executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps);
  expect(state.tasks[id(2)].phase).toBe('waiting');
  const previous = f.tasks.get(id(1))!; f.tasks.set(id(1), { ...previous, status: 'done', version: previous.version + 2 });
  let calls = 0; f.deps.codex = async () => { calls++; return f.result; };
  const resumed = await executePlan(f.plan, state, false, '/tmp', '/tmp', f.deps);
  expect(calls).toBe(2); expect(resumed.tasks[id(2)].phase).toBe('review');
});
it('refuses to replay an ambiguous interrupted network mutation', async () => {
  const f = setup(); f.deps.client.update = async () => { throw new Error('Connection lost'); };
  let saved: RunState | undefined; f.deps.save = (s) => { saved = structuredClone(s); };
  await expect(executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps)).rejects.toThrow('Connection lost');
  expect(saved?.pending).toBeTruthy();
  await expect(executePlan(f.plan, saved, false, '/tmp', '/tmp', f.deps)).rejects.toThrow('ambiguous');
});
it('records genuine exit status for silent checks without submitting an invalid empty result', async () => {
  const f = setup(); let submitted: Record<string, unknown> | undefined;
  const report = f.deps.client.report;
  f.deps.client.report = async (key, v, input, m) => { submitted = input; return report(key, v, input, m); };
  f.deps.check = async () => ({ command: 'npm test', result: '', outcome: 'passed', exitCode: 0 });
  await executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps);
  expect(submitted?.tests).toMatchObject([{ result: 'exitCode=0', exitCode: 0 }]);
});
it('reports observed passing exit status while preserving verbose evidence for the separate reviewer', async () => {
  const f = setup(); let submitted: Record<string, unknown> | undefined, reviewPrompt = '';
  const report = f.deps.client.report;
  f.deps.client.report = async (key, v, input, m) => { submitted = input; return report(key, v, input, m); };
  f.deps.check = async () => ({ command: 'npm test', result: '✓ handles error; ✓ records failed requests', outcome: 'passed', exitCode: 0 });
  f.deps.codex = async (input) => { if (input.mode === 'review') reviewPrompt = input.prompt; return f.result; };
  await executePlan(f.plan, undefined, false, '/tmp', '/tmp', f.deps);
  expect(submitted?.tests).toMatchObject([{ result: 'exitCode=0', exitCode: 0 }]);
  expect(reviewPrompt).toContain('handles error');
});
it('stops immediately when an adapter returns normally after interruption', async () => {
  const f = setup(); let interrupted = false, checks = 0;
  const deps = { ...f.deps, isInterrupted: () => interrupted };
  deps.codex = async () => { interrupted = true; return f.result; };
  deps.check = async () => { checks++; return { command: 'test', result: 'ok', outcome: 'passed', exitCode: 0 }; };
  await expect(executePlan(f.plan, undefined, true, '/tmp', '/tmp', deps)).rejects.toThrow('interrupt');
  expect(checks).toBe(0); expect(f.actions).not.toContain('report:success'); expect(f.actions).not.toContain('accept');
});
it('resumes preauthorized review checkpoint by rechecking and reviewing without reimplementing', async () => {
  const f = setup(); let saved: RunState | undefined;
  f.deps.save = (s) => { saved = structuredClone(s); if (s.tasks[id(1)].phase === 'review') throw new Error('simulated crash'); };
  await expect(executePlan(f.plan, undefined, true, '/tmp', '/tmp', f.deps)).rejects.toThrow('simulated crash');
  f.deps.save = () => {}; const modes: string[] = [];
  f.deps.codex = async (input) => { modes.push(input.mode); return f.result; };
  const state = await executePlan(f.plan, saved, true, '/tmp', '/tmp', f.deps);
  expect(modes).toEqual(['review']); expect(state.outcome).toBe('complete'); expect(f.actions).toContain('accept');
});
