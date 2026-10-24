import { mkdtempSync, statSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, afterEach } from 'vitest';
import { ApiClient, ApiRequestError, UnsupportedCapabilityError } from '../api-client.js';
import { listOutbox, submitMutation } from './outbox.js';
import { writeTaskMirror, archiveTaskMirror } from './task-mirror.js';
import { buildReportOptions } from '../commands/execution.js';
import { daemonLog } from './state.js';
import { retryDelay } from '../commands/daemon.js';
import { chooseNextTask } from '../commands/status.js';
afterEach(() => vi.restoreAllMocks());
it('persists the mutation ID before sending and retains it after an ambiguous failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-reliable-'));
  let id = '';
  await expect(submitMutation({ type: 'work-item.update', payload: { id: 'task' } }, async (event) => {
    id = event.id;
    expect(listOutbox(root)[0].id).toBe(id);
    throw new TypeError('network');
  }, root)).rejects.toThrow('network');
  expect(listOutbox(root)[0].id).toBe(id);
  await expect(submitMutation({ type: 'work-item.update', payload: { id: 'task' } }, async () => { throw new ApiRequestError(400, 'invalid'); }, root)).rejects.toThrow('invalid');
  expect(listOutbox(root)).toHaveLength(1);
});
it('keeps unchanged mirror mtimes and archives managed task files', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-reliable-'));
  const task = { id: 'task', title: 'Task', type: 'feature', status: 'ready', priority: 'P2', version: 1 };
  const path = writeTaskMirror(task, root);
  const before = statSync(path).mtimeMs;
  writeTaskMirror(task, root);
  expect(statSync(path).mtimeMs).toBe(before);
  archiveTaskMirror(task.id, root);
  expect(existsSync(path)).toBe(false);
  expect(existsSync(join(root, '.vibe', 'archive', 'task.md'))).toBe(true);
});
it('preserves structured test outcome and exit code', () => {
  expect(buildReportOptions({ report: { tests: [{ command: 'test', result: 'failed', outcome: 'failed', exitCode: 1 }] } }).tests?.[0]).toEqual({ command: 'test', result: 'failed', outcome: 'failed', exitCode: 1 });
});
it('attaches the same idempotency key to API mutations', async () => {
  const request = vi.spyOn(ApiClient.prototype, 'request').mockResolvedValue({});
  await new ApiClient('http://localhost:4000').updateWorkItem('task', 1, {}, 'stable-id');
  expect(request.mock.calls[0][1]).toMatchObject({ headers: { 'X-Mutation-ID': 'stable-id' } });
  await new ApiClient('http://localhost:4000').createWorkItem('project', {}, 'create-id');
  expect(request.mock.calls[1][1]).toMatchObject({ headers: { 'X-Mutation-ID': 'create-id' } });
});
it('rotates logs at 5MiB with five retained backups and bounds retry delay', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-reliable-'));
  daemonLog(root, 'start');
  const path = join(root, '.vibe', 'daemon.log');
  for (let i = 0; i < 7; i++) { writeFileSync(path, 'x'.repeat(5 * 1024 * 1024)); daemonLog(root, `rotation ${i}`); }
  expect(existsSync(`${path}.5`)).toBe(true);
  expect(existsSync(`${path}.6`)).toBe(false);
  expect(readFileSync(path, 'utf8')).toContain('rotation 6');
  expect(retryDelay(1, 2000, () => 0)).toBe(2000);
  expect(retryDelay(30, 2000, () => 1)).toBe(60000);
});
it('does not recommend blocked or review tasks or tasks with unresolved blockers', () => {
  const tasks = ['blocked', 'in_review', 'ready'].map((status) => ({ id: status, title: status, status, priority: 'P1' }));
  expect(chooseNextTask(tasks)?.id).toBe('ready');
  expect(chooseNextTask([{ ...tasks[2], blockers: [{}] }])).toBeUndefined();
});
it('normalizes snapshot and ordered delta sync-feed responses', async () => {
  const client = new ApiClient('http://localhost:4000');
  vi.spyOn(client, 'request').mockResolvedValueOnce({ mode: 'snapshot', cursor: '1', items: [{ id: 'task' }], hasMore: false }).mockResolvedValueOnce({ mode: 'delta', cursor: '2', hasMore: false, changes: [{ sequence: '2', id: 'task', action: 'delete' }] });
  expect(await client.sync('project')).toMatchObject({ items: [{ id: 'task' }], deletedIds: [] });
  expect(await client.sync('project', '1')).toMatchObject({ items: [], deletedIds: ['task'] });
});
it('preserves unsupported structured reports as paused operations without losing evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-structured-'));
  const report = { tests: [{ command: 'test', result: 'passed', outcome: 'failed', exitCode: 1 }] };
  await expect(submitMutation({ type: 'work-item.report', payload: { id: 'task', report } }, async () => { throw new UnsupportedCapabilityError('Upgrade server'); }, root)).rejects.toThrow('Upgrade');
  expect(listOutbox(root)[0]).toMatchObject({ paused: true, payload: { report } });
});
