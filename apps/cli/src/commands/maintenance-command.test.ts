import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { listOutbox } from '../sync/outbox.js';
import { taskContext, updateTask } from './maintenance.js';

vi.mock('../auth.js', () => ({ loadSession: vi.fn(async () => ({ server: 'https://example.test', accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x` })) }));
vi.mock('../config.js', () => ({ loadProjectConfig: vi.fn(() => ({ server: 'https://example.test', projectId: 'project', teamId: 'team', organizationId: 'org' })) }));
const root = mkdtempSync(join(tmpdir(), 'vibe-maintenance-command-'));
vi.mock('../sync/outbox.js', async (original) => {
  const actual = await original<typeof import('../sync/outbox.js')>();
  return { ...actual, submitMutation: (input: Parameters<typeof actual.submitMutation>[0], send: Parameters<typeof actual.submitMutation>[1]) => actual.submitMutation(input, send, root) };
});
const file = join(root, 'patch.json');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('maintenance command boundaries', () => {
  it('uses a live task version and an idempotent update with only the approved patch fields', async () => {
    writeFileSync(file, JSON.stringify({ status: 'blocked', executionNote: 'Waiting on API; owner: team lead' }));
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'PATCH' ? { version: 4, status: 'blocked' } : { id: 'task', projectId: 'project', version: 3 }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await updateTask('task', 3, file);
    expect(request).toHaveBeenLastCalledWith('https://example.test/api/work-items/task', expect.objectContaining({ method: 'PATCH', headers: expect.objectContaining({ 'X-Mutation-ID': expect.any(String) }), body: JSON.stringify({ status: 'blocked', executionNote: 'Waiting on API; owner: team lead', version: 3 }) }));
    expect(listOutbox(root)).toHaveLength(0);
  });
  it.each([{ projectId: 'another', version: 3 }, { projectId: 'project', version: 4 }])('refuses a cross-project or stale task before mutating: %j', async (task) => {
    writeFileSync(file, JSON.stringify({ estimate: 3 }));
    const request = vi.fn(async () => new Response(JSON.stringify({ id: 'task', ...task }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    await expect(updateTask('task', 3, file)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(listOutbox(root)).toHaveLength(0);
  });
  it('does not read a task from a different server or an unbound directory', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    vi.mocked(loadSession).mockResolvedValueOnce({ server: 'https://other.test', accessToken: 'token' });
    await expect(taskContext('task')).rejects.toThrow('server');
    vi.mocked(loadProjectConfig).mockReturnValueOnce(undefined);
    await expect(taskContext('task')).rejects.toThrow('init');
    expect(request).not.toHaveBeenCalled();
  });
  it('fetches context once and outputs repair guidance without any mutation', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ id: 'task', projectId: 'project', version: 3, status: 'blocked', planMarkdown: '# Plan', events: [] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    await taskContext('task');
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ task: { version: 3 }, planMarkdown: '# Plan', nextAction: expect.stringContaining('resume') });
  });
});
