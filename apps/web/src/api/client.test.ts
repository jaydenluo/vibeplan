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

  it('explains the current status and next step for a rejected acceptance transition', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    window.addEventListener(messageEvent, ((event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); }) as EventListener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 400, {
      error: {
        code: 'INVALID_TRANSITION',
        message: 'Only a task awaiting review can be accepted.',
        details: {
          currentStatus: 'in_progress',
          allowedStatuses: ['in_review'],
          nextAction: 'submit_execution_report',
        },
      },
    })));

    await expect(apiRequest('/work-items/task-1/accept', { method: 'POST', body: '{}' })).rejects.toThrow('无法验收：任务当前为「进行中」。验收仅支持「待审核」状态；请先提交成功执行报告。');

    expect(messages).toEqual([{ text: '无法验收：任务当前为「进行中」。验收仅支持「待审核」状态；请先提交成功执行报告。', tone: 'error' }]);
  });

  it('explains why a parent schedule cannot be adjusted and how to change it', async () => {
    const messages: Array<{ text: string; tone: string }> = [];
    const listener = (event: Event) => { messages.push((event as CustomEvent<{ text: string; tone: string }>).detail); };
    window.addEventListener(messageEvent, listener);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 400, {
      error: { code: 'INVALID_TRANSITION', message: 'Parent task schedule is derived from child tasks.', details: { reason: 'parent_schedule_derived' } },
    })));
    const message = '无法调整父任务日期：该任务包含子任务，开始和结束日期由子任务自动汇总。请调整子任务日期，父任务会随之更新。';
    try {
      await expect(apiRequest('/work-items/parent-1', { method: 'PATCH', body: JSON.stringify({ version: 1, dueDate: '2026-11-12', estimate: 3 }) })).rejects.toThrow(message);
      expect(messages).toEqual([{ text: message, tone: 'error' }]);
    } finally {
      window.removeEventListener(messageEvent, listener);
    }
  });

  it('shows a Chinese message when email delivery is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(false, 503, { error: { code: 'EMAIL_DELIVERY_NOT_CONFIGURED', message: 'Email delivery is not configured.' } })));

    await expect(apiRequest('/auth/register/request-code', { method: 'POST', body: '{}' })).rejects.toThrow('邮件服务尚未配置，请联系管理员。');
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
