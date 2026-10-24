import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgressPatch, buildReportOptions, uploadTaskPlan, updateTaskProgress } from './execution.js';
import { reportTask, startTask } from './task.js';
import { ApiClient } from '../api-client.js';
import { listOutbox } from '../sync/outbox.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../auth.js', () => ({ loadSession: vi.fn(async () => ({ server: 'https://example.test/api', accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x` })) }));
vi.mock('../config.js', () => ({ loadProjectConfig: vi.fn(() => ({ server: 'https://example.test/api', projectId: 'project', organizationId: 'org', teamId: 'team' })) }));
const testRoot = mkdtempSync(join(tmpdir(), 'vibe-execution-'));
vi.mock('../sync/outbox.js', async (original) => {
  const actual = await original<typeof import('../sync/outbox.js')>();
  return { ...actual, submitMutation: (input: Parameters<typeof actual.submitMutation>[0], send: Parameters<typeof actual.submitMutation>[1]) => actual.submitMutation(input, send, testRoot) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('execution CLI', () => {
  it('preserves structured failed report details and criterion evidence', () => {
    const report = { outcome: 'failed', risks: ['migration'], remainingIssues: ['repair test'], evidence: [{ label: 'CI', url: 'https://example.test/run' }], criterionResults: [{ acceptanceItemId: 'criterion', result: 'failed', evidence: [{ label: 'CI', url: 'https://example.test/run' }] }] };
    expect(buildReportOptions({ report })).toMatchObject(report);
  });
  it('accepts repeated flags and defaults the outcome to success', () => {
    expect(buildReportOptions({ evidence: ['https://example.test/run'], risk: ['review'], remainingIssue: ['follow up'], test: ['pnpm test=failed'] })).toMatchObject({ outcome: 'success', evidence: [{ label: 'https://example.test/run', url: 'https://example.test/run' }], risks: ['review'], remainingIssues: ['follow up'], tests: [{ command: 'pnpm test', result: 'failed' }] });
  });
  it('requires an explicit test result and rejects malformed report lists', () => {
    expect(() => buildReportOptions({ test: ['pnpm test'] })).toThrow('actual result');
    expect(() => buildReportOptions({ report: { tests: [{ command: 'pnpm test', result: '' }] } })).toThrow('Test result');
    expect(() => buildReportOptions({ report: { risks: 'untyped risk' } })).toThrow('arrays');
  });
  it('combines file evidence with flags without discarding structured test results', () => {
    expect(buildReportOptions({ report: { tests: [{ command: 'pnpm test', result: 'failed' }], evidence: [{ label: 'CI', url: 'https://example.test/ci' }] }, evidence: ['https://example.test/screenshot'] })).toMatchObject({ tests: [{ command: 'pnpm test', result: 'failed' }], evidence: [{ label: 'CI', url: 'https://example.test/ci' }, { label: 'https://example.test/screenshot', url: 'https://example.test/screenshot' }] });
  });
  it.each([{ outcome: 'done' }, { evidence: [{ label: 'bad', url: 'javascript:alert(1)' }] }, { criterionResults: [{ acceptanceItemId: 'x', result: '', evidence: [] }] }])('rejects invalid reports before transmission: %j', (report) => {
    expect(() => buildReportOptions({ report })).toThrow();
  });
  it('keeps execution stage independent from task status', () => {
    expect(buildProgressPatch(40, 'testing', 'Running tests')).toEqual({ progress: 40, executionStage: 'testing', executionNote: 'Running tests' });
    expect(() => buildProgressPatch(101, 'testing', 'x')).toThrow();
    expect(() => buildProgressPatch(40, 'done', 'x')).toThrow();
  });
  it('records a real blocker as blocked status so it appears in My Work', () => {
    expect(buildProgressPatch(40, 'blocked', 'Waiting for API owner')).toMatchObject({ status: 'blocked', executionStage: 'blocked', executionNote: 'Waiting for API owner' });
  });
  it('uploads Markdown and progress through versioned updates', async () => {
    const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockResolvedValue({ version: 4 });
    vi.spyOn(ApiClient.prototype, 'workItem').mockResolvedValueOnce({ id: 'task', projectId: 'project', version: 3 }).mockResolvedValueOnce({ id: 'task', projectId: 'project', version: 4 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await uploadTaskPlan('task', 3, '# Execution plan');
    await updateTaskProgress('task', 4, 40, 'testing', 'Running tests');
    expect(update).toHaveBeenNthCalledWith(1, 'task', 3, { planMarkdown: '# Execution plan' }, expect.any(String));
    expect(update).toHaveBeenNthCalledWith(2, 'task', 4, { progress: 40, executionStage: 'testing', executionNote: 'Running tests' }, expect.any(String));
  });
  it('rejects execution writes when the task is not bound to the local project or version', async () => {
    const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem');
    vi.spyOn(ApiClient.prototype, 'workItem').mockResolvedValue({ id: 'task', projectId: 'other-project', version: 3 });
    await expect(uploadTaskPlan('task', 3, '# Plan')).rejects.toThrow('Task does not belong to the initialized project.');
    vi.spyOn(ApiClient.prototype, 'workItem').mockResolvedValue({ id: 'task', projectId: 'project', version: 4 });
    await expect(updateTaskProgress('task', 3, 40, 'testing', 'Tests')).rejects.toThrow('Task version changed.');
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects empty plans and invalid versions before making requests', async () => {
    const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem');
    await expect(uploadTaskPlan('task', 3, '  ')).rejects.toThrow('Plan Markdown');
    await expect(updateTaskProgress('task', Number.NaN, 40, 'testing', 'Tests')).rejects.toThrow('Task version');
    await expect(reportTask('task', 2, ' ')).rejects.toThrow('summary');
    expect(update).not.toHaveBeenCalled();
    expect(listOutbox(testRoot)).toHaveLength(0);
  });
  it('queues plan updates only for transient failures', async () => {
    vi.spyOn(ApiClient.prototype, 'workItem').mockResolvedValue({ id: 'task', projectId: 'project', version: 3 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await expect(uploadTaskPlan('task', 3, '# Plan')).rejects.toThrow();
    expect(listOutbox(testRoot)).toEqual([expect.objectContaining({ type: 'work-item.update', origin: { server: 'https://example.test/api', actorId: 'actor' }, payload: { id: 'task', version: 3, patch: { planMarkdown: '# Plan' } } })]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })));
    await expect(updateTaskProgress('task', 3, 40, 'testing', 'Tests')).rejects.toThrow();
    expect(listOutbox(testRoot)).toHaveLength(1);
  });
  it('submits failed reports without masking failed tests', async () => {
    const report = vi.spyOn(ApiClient.prototype, 'reportWorkItem').mockResolvedValue({ status: 'in_progress' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await reportTask('task', 2, 'Failed tests', buildReportOptions({ outcome: 'failed', test: ['pnpm test=failed'] }));
    expect(report).toHaveBeenCalledWith('task', expect.objectContaining({ outcome: 'failed', tests: [{ command: 'pnpm test', result: 'failed' }] }), expect.any(String));
  });
  it.each([400, 401, 403, 409, 422])('does not queue definitive HTTP %s failures', async (status) => {
    const before = listOutbox(testRoot).length;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Rejected' } }), { status })));
    await expect(reportTask('task', 2, 'Summary')).rejects.toThrow();
    await expect(startTask('task', 2)).rejects.toThrow();
    expect(listOutbox(testRoot)).toHaveLength(before);
  });
  it.each([503, 'network'])('queues transient %s failures with the full report', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async () => { if (failure === 'network') throw new TypeError('fetch failed'); return new Response('{}', { status: 503 }); }));
    await expect(reportTask('task', 2, 'Blocked', { outcome: 'blocked', remainingIssues: ['Retry'] })).rejects.toThrow();
    expect(listOutbox(testRoot)).toContainEqual(expect.objectContaining({ type: 'work-item.report', payload: { id: 'task', report: expect.objectContaining({ outcome: 'blocked', remainingIssues: ['Retry'] }) } }));
  });
});
