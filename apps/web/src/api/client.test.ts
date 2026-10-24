/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, getPlatformAdminMe, messageEvent } from './client.js';

function response(ok: boolean, status: number, payload: unknown = {}) {
  return { ok, status, json: async () => payload };
}

describe('apiRequest authentication recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('does not rotate the refresh token when another tab has already restored the session', async () => {
    const lockRequest = vi.fn(async (_name: string, callback: () => Promise<boolean>) => callback());
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: lockRequest } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(false, 401, { error: { message: 'Access token expired.' } }))
      .mockResolvedValueOnce(response(true, 200))
      .mockResolvedValueOnce(response(true, 200, { id: 'user-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ id: string }>('/auth/me')).resolves.toEqual({ id: 'user-1' });

    expect(lockRequest).toHaveBeenCalledWith('vibe-plan-auth-refresh', expect.any(Function));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/refresh'))).toBe(false);
  });

  it('publishes one global error message for failed requests', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } })));

    await expect(apiRequest('/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow('邮箱或密码错误。');

    expect(messages).toEqual([{ text: '邮箱或密码错误。', tone: 'error' }]);
  });

  it('does not expose an unknown server error message to the page', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 500, { error: { code: 'UNRECOGNIZED_ERROR', message: 'An internal database exception.' } })));

    await expect(apiRequest('/projects')).rejects.toThrow('请求失败，请稍后重试。');

    expect(messages).toEqual([{ text: '请求失败，请稍后重试。', tone: 'error' }]);
  });

  it('publishes a success message for write requests but not reads', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(true, 200, { id: 'task' })));

    await apiRequest('/projects');
    await apiRequest('/projects', { method: 'POST', body: '{}' });

    expect(messages).toEqual([{ text: '操作成功', tone: 'success' }]);
  });

  it('treats an empty successful response as a successful write', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no content'); } }));

    await expect(apiRequest<void>('/resource', { method: 'DELETE' })).resolves.toBeUndefined();

    expect(messages).toEqual([{ text: '操作成功', tone: 'success' }]);
  });

  it('does not toast the expected non-admin response', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 403, { error: { code: 'PLATFORM_ADMIN_REQUIRED', message: 'Platform administrator access is required.' } })));

    await expect(getPlatformAdminMe()).rejects.toThrow('需要平台管理员权限。');

    expect(messages).toEqual([]);
  });
});
