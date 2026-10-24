import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiRequestError, isRetryableApiError } from './api-client.js';
import { loadSession, saveSession } from './auth.js';

vi.mock('keytar', () => ({ default: { getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() } }));
import keytar from 'keytar';

const original = { server: 'https://example.test/api', accessToken: 'old-access', refreshToken: 'old-refresh' };
const renewed = { ...original, accessToken: 'new-access', refreshToken: 'new-refresh' };
let stored: string | null;
beforeEach(() => {
  stored = JSON.stringify(original);
  vi.mocked(keytar.getPassword).mockImplementation(async () => stored);
  vi.mocked(keytar.setPassword).mockImplementation(async (_s, _a, value) => { stored = value; });
  vi.mocked(keytar.deletePassword).mockImplementation(async () => { stored = null; return true; });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const response = (status: number, body = {}) => new Response(JSON.stringify(body), { status });

describe('shared CLI authentication', () => {
  it('refuses structured test evidence when the server cannot retain it', async () => {
    const client = new ApiClient(original.server, original);
    vi.spyOn(client, 'serverInfo').mockResolvedValue({ version: 'legacy', protocolVersion: 1, capabilities: [] });
    const request = vi.spyOn(client, 'request').mockResolvedValue({});
    await expect(client.reportWorkItem('task', { version: 1, tests: [{ command: 'test', result: 'passed', outcome: 'failed', exitCode: 1 }] }, 'operation')).rejects.toThrow('升级');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps simple legacy reports compatible without a capability request', async () => {
    const client = new ApiClient(original.server, original);
    const info = vi.spyOn(client, 'serverInfo');
    vi.spyOn(client, 'request').mockResolvedValue({ status: 'in_review' });
    await client.reportWorkItem('task', { tests: [{ command: 'test', result: 'failed' }] });
    expect(info).not.toHaveBeenCalled();
  });
  it('transmits structured test evidence intact when capability is supported', async () => {
    const client = new ApiClient(original.server, original);
    vi.spyOn(client, 'serverInfo').mockResolvedValue({ version: 'current', protocolVersion: 1, capabilities: ['structured-tests'] });
    const request = vi.spyOn(client, 'request').mockResolvedValue({});
    const input = { tests: [{ command: 'test', result: 'passed', outcome: 'failed', exitCode: 1 }] };
    await client.reportWorkItem('task', input, 'operation');
    expect(request).toHaveBeenCalledWith('/work-items/task/report', expect.objectContaining({ body: JSON.stringify(input) }));
  });
  it('keeps credentials on a temporary refresh server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(502)));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow(/502/);
    expect(await loadSession()).toEqual(original);
  });
  it('classifies temporary refresh errors as retryable API failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(503)));
    const failure = await new ApiClient(original.server, original).me().catch((error) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(isRetryableApiError(failure)).toBe(true);
  });

  it('keeps credentials when the refresh network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockRejectedValueOnce(new Error('fetch failed')));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow('fetch failed');
    expect(await loadSession()).toEqual(original);
  });

  it('keeps credentials when a successful refresh has malformed data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200, {})));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow('无效数据');
    expect(await loadSession()).toEqual(original);
  });

  it('reuses credentials renewed by another process instead of refreshing an old token', async () => {
    await saveSession(renewed);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200, { id: 'user' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new ApiClient(original.server, original).me()).toEqual({ id: 'user' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/refresh'))).toBe(false);
    expect(await loadSession()).toEqual(renewed);
  });

  it('serializes concurrent refreshes and shares the replacement session', async () => {
    let refreshCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCount++;
        return response(200, renewed);
      }
      return (init?.headers as Record<string, string>).Authorization === 'Bearer new-access'
        ? response(200, { id: 'user' }) : response(401);
    }));
    await Promise.all([new ApiClient(original.server, original).me(), new ApiClient(original.server, original).me()]);
    expect(refreshCount).toBe(1);
    expect(await loadSession()).toEqual(renewed);
  });

  it('clears a definitively rejected current refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(401)));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow('Authentication');
    expect(await loadSession()).toBeUndefined();
  });

  it('recognizes invalid refresh tokens returned as 400 by older servers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(400, { error: { code: 'INVALID_REFRESH_TOKEN' } })));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow('Authentication');
    expect(await loadSession()).toBeUndefined();
  });

  it('preserves credentials for an unrelated refresh validation error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(400, { error: { code: 'VALIDATION_ERROR' } })));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow(/400/);
    expect(await loadSession()).toEqual(original);
  });

  it('does not erase a newer login when a retried access request is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200, renewed)).mockResolvedValueOnce(response(401)));
    await expect(new ApiClient(original.server, original).me()).rejects.toThrow('Authentication');
    expect(await loadSession()).toEqual(renewed);
  });
  it('does not reuse another account login for a pending mutation', async () => {
    const token = (sub: string) => `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.x`;
    const first = { ...original, accessToken: token('actor-a') };
    const second = { ...renewed, accessToken: token('actor-b') };
    await saveSession(second);
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new ApiClient(first.server, first).updateWorkItem('task', 1, {}, 'operation')).rejects.toThrow('Authentication');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await loadSession()).toEqual(second);
  });
});
