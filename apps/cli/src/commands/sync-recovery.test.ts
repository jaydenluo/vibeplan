import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiClient, ApiRequestError } from '../api-client.js';
import { AuthenticationRequiredError } from '../errors.js';
import { loadSession } from '../auth.js';
import { writeProjectConfig } from '../config.js';
import { discardPausedOutbox, enqueueOutbox, listOutbox } from '../sync/outbox.js';
import { flushOutbox } from './sync.js';

const actorToken = `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x`;
vi.mock('../auth.js', () => ({ loadSession: vi.fn(async () => ({ server: 'https://example.test/api', accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x` })) }));
afterEach(() => { vi.restoreAllMocks(); vi.mocked(loadSession).mockResolvedValue({ server: 'https://example.test/api', accessToken: actorToken, refreshToken: 'refresh' }); });

it('preserves a conflicting queued operation but stops automatically retrying it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-recovery-'));
  writeProjectConfig({ server: 'https://example.test/api', projectId: 'project', teamId: 'team', organizationId: 'org' }, root);
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'task', version: 3, patch: { progress: 40 } }, origin: { server: 'https://example.test/api', actorId: 'actor' } }, root);
  const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockRejectedValue(new ApiRequestError(409, 'version conflict'));
  await flushOutbox(root);
  await flushOutbox(root);
  expect(update).toHaveBeenCalledTimes(1);
  expect(listOutbox(root)[0]).toMatchObject({ paused: true, retryCount: 1, lastError: 'version conflict' });
  discardPausedOutbox(listOutbox(root)[0].id, root);
  expect(listOutbox(root)).toEqual([]);
});

it('does not discard an operation that is still eligible for retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-recovery-'));
  const event = enqueueOutbox({ type: 'work-item.update', payload: { id: 'task' } }, root);
  expect(() => discardPausedOutbox(event.id, root)).toThrow('paused');
  expect(listOutbox(root)).toHaveLength(1);
});

it('pauses queued authentication failures with re-login guidance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-auth-recovery-'));
  writeProjectConfig({ server: 'https://example.test/api', projectId: 'project', teamId: 'team', organizationId: 'org' }, root);
  const origin = { server: 'https://example.test/api', actorId: 'actor' };
  vi.mocked(loadSession).mockResolvedValue({ server: origin.server, accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'actor' })).toString('base64url')}.x`, refreshToken: 'refresh' });
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'task', version: 1, patch: {} }, origin }, root);
  vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockRejectedValue(new AuthenticationRequiredError(origin.server));
  await flushOutbox(root);
  expect(listOutbox(root)[0]).toMatchObject({ paused: true, lastError: expect.stringContaining('vibeplan login') });
});

it('pauses cross-account and legacy events before sending anything', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-origin-recovery-'));
  writeProjectConfig({ server: 'https://example.test/api', projectId: 'project', teamId: 'team', organizationId: 'org' }, root);
  vi.mocked(loadSession).mockResolvedValue({ server: 'https://example.test/api', accessToken: `x.${Buffer.from(JSON.stringify({ sub: 'new-actor' })).toString('base64url')}.x`, refreshToken: 'refresh' });
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'task', version: 1, patch: {} }, origin: { server: 'https://example.test/api', actorId: 'old-actor' } }, root);
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'legacy', version: 1, patch: {} } }, root);
  const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockResolvedValue({});
  await flushOutbox(root);
  expect(update).not.toHaveBeenCalled();
  expect(listOutbox(root).every((event) => event.paused)).toBe(true);
  expect(listOutbox(root)[1].lastError).toContain('origin');
});

it('pauses a queue belonging to another API server even for the same actor', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-server-recovery-'));
  writeProjectConfig({ server: 'https://example.test/api', projectId: 'project', teamId: 'team', organizationId: 'org' }, root);
  vi.mocked(loadSession).mockResolvedValue({ server: 'https://new.example.test/api', accessToken: actorToken, refreshToken: 'refresh' });
  enqueueOutbox({ type: 'work-item.update', payload: { id: 'task', version: 1, patch: {} }, origin: { server: 'https://example.test/api', actorId: 'actor' } }, root);
  const update = vi.spyOn(ApiClient.prototype, 'updateWorkItem').mockResolvedValue({});
  await flushOutbox(root);
  expect(update).not.toHaveBeenCalled();
  expect(listOutbox(root)[0]).toMatchObject({ paused: true, lastError: expect.stringContaining('another account/server') });
});
