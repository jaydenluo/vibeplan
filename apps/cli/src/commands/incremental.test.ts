import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiRequestError } from '../api-client.js';
import { writeProjectConfig } from '../config.js';
import { syncTasks, flushOutbox, inspectPending } from './sync.js';
import { readSyncState } from '../sync/state.js';
import { enqueueOutbox, listOutbox, updateOutbox } from '../sync/outbox.js';
vi.mock('../auth.js', () => ({ loadSession: vi.fn(async () => ({ server: 'https://example.test/api', accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x` })) }));
afterEach(() => vi.restoreAllMocks());
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-incremental-'));
  writeProjectConfig({ server: 'https://example.test/api', projectId: 'project', teamId: 'team', organizationId: 'org' }, root);
  return root;
}
const task = { id: 'task', title: 'Task', version: 1, type: 'feature', status: 'ready', priority: 'P2' };
it('consumes delta pages, archives only managed mirrors and commits cursor after all writes', async () => {
  const root = setup();
  vi.spyOn(ApiClient.prototype, 'serverInfo').mockResolvedValue({ version: '2', protocolVersion: 2, capabilities: ['incremental-sync'] });
  const sync = vi.spyOn(ApiClient.prototype, 'sync')
    .mockResolvedValueOnce({ cursor: '1', hasMore: false, items: [task], deletedIds: [] })
    .mockResolvedValueOnce({ cursor: '2', hasMore: true, items: [{ ...task, version: 2 }], deletedIds: [] })
    .mockResolvedValueOnce({ cursor: '3', hasMore: false, items: [], deletedIds: ['task', 'personal'] });
  await syncTasks(root);
  writeFileSync(join(root, '.vibe', 'tasks', 'personal.md'), '# Personal notes');
  await syncTasks(root);
  expect(sync).toHaveBeenNthCalledWith(2, 'project', '1');
  expect(readSyncState(root)).toMatchObject({ cursor: '3', count: 0 });
  expect(existsSync(join(root, '.vibe', 'archive', 'task.md'))).toBe(true);
  expect(readFileSync(join(root, '.vibe', 'tasks', 'personal.md'), 'utf8')).toBe('# Personal notes');
});
it('preserves the checkpoint when a later page fails', async () => {
  const root = setup();
  vi.spyOn(ApiClient.prototype, 'serverInfo').mockResolvedValue({ version: '2', protocolVersion: 2, capabilities: ['incremental-sync'] });
  vi.spyOn(ApiClient.prototype, 'sync').mockResolvedValueOnce({ cursor: '1', hasMore: false, items: [task], deletedIds: [] });
  await syncTasks(root);
  vi.spyOn(ApiClient.prototype, 'sync').mockResolvedValueOnce({ cursor: '2', hasMore: true, items: [], deletedIds: [] }).mockRejectedValueOnce(new TypeError('network'));
  await expect(syncTasks(root)).rejects.toThrow('network');
  expect(readSyncState(root)).toMatchObject({ cursor: '1', error: 'network' });
});
it('resets expired cursors with a fresh snapshot', async () => {
  const root = setup();
  vi.spyOn(ApiClient.prototype, 'serverInfo').mockResolvedValue({ version: '2', protocolVersion: 2, capabilities: ['incremental-sync'] });
  const sync = vi.spyOn(ApiClient.prototype, 'sync').mockResolvedValueOnce({ cursor: '1', hasMore: false, items: [task], deletedIds: [] });
  await syncTasks(root);
  sync.mockRejectedValueOnce(new ApiRequestError(409, 'reset', 'SYNC_RESET_REQUIRED')).mockResolvedValueOnce({ cursor: '5', hasMore: false, items: [], deletedIds: [] });
  await syncTasks(root);
  expect(sync).toHaveBeenLastCalledWith('project');
  expect(readSyncState(root)).toMatchObject({ cursor: '5', count: 0 });
});
it('recognizes the server sync-feed capability', async () => {
  const root = setup();
  vi.spyOn(ApiClient.prototype, 'serverInfo').mockResolvedValue({ version: '2', protocolVersion: 1, capabilities: ['sync-feed'] });
  const sync = vi.spyOn(ApiClient.prototype, 'sync').mockResolvedValue({ cursor: '1', hasMore: false, items: [task], deletedIds: [] });
  vi.spyOn(ApiClient.prototype, 'workItems').mockResolvedValue([]);
  await syncTasks(root);
  expect(sync).toHaveBeenCalled();
  expect(readSyncState(root).cursor).toBe('1');
});
it('blocks later operations for a paused task but flushes unrelated tasks', async () => {
  const root = setup();
  const origin = { server: 'https://example.test/api', actorId: 'actor' };
  const first = enqueueOutbox({ type: 'work-item.update', payload: { id: 'task', version: 1, patch: {} }, origin }, root);
  updateOutbox({ ...first, paused: true }, root);
  enqueueOutbox({ type: 'work-item.report', payload: { id: 'task', report: {} }, origin }, root);
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'other', version: 1, patch: {} }, origin }, root);
  const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockResolvedValue({});
  const report = vi.spyOn(ApiClient.prototype, 'reportWorkItem').mockResolvedValue({});
  await flushOutbox(root);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith('other', 1, {}, expect.any(String));
  expect(report).not.toHaveBeenCalled();
  expect(listOutbox(root)).toHaveLength(2);
  vi.spyOn(ApiClient.prototype, 'workItem').mockResolvedValue({ ...task, projectId: 'project', version: 4 });
  expect(await inspectPending(root)).toContainEqual(expect.objectContaining({ taskTitle: 'Task', currentVersion: 4 }));
});
