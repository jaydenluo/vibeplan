import { sessionStore, withSessionLock, type Session } from './auth.js';
import { AuthenticationRequiredError } from './errors.js';
import { sessionActorId } from './session-identity.js';

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}
export class UnsupportedCapabilityError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedCapabilityError'; }
}

export function isRetryableApiError(error: unknown): boolean {
  return error instanceof ApiRequestError ? error.status >= 500 : error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export function normalizeServer(server: string): string {
  const value = server.replace(/\/$/, '');
  const url = new URL(value);
  if (url.pathname && url.pathname !== '/') return value;
  const isLocalApi = (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') && url.port === '4000';
  return isLocalApi ? value : `${value}/api`;
}

export class ApiClient {
  private readonly server: string;
  private session?: Session;
  private capabilitiesPromise?: Promise<ServerInfo>;

  constructor(server: string, session?: Session) {
    this.server = normalizeServer(server);
    this.session = session;
  }

  async request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
    const response = await fetch(`${this.server.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        ...(init.body == null ? {} : { 'Content-Type': 'application/json' }),
        ...(this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && allowRefresh && this.session?.refreshToken && path !== '/auth/refresh') {
      const refreshed = await this.requestRefresh();
      if (refreshed) return this.request<T>(path, init, false);
    }
    if (response.status === 401 && this.session) {
      const server = this.session.server;
      throw new AuthenticationRequiredError(server);
    }
    if (!response.ok) {
      throw new ApiRequestError(response.status, payload.error?.message ?? `API request failed: ${response.status}`, payload.error?.code);
    }
    return payload as T;
  }

  private async requestRefresh(): Promise<boolean> {
    if (!this.session?.refreshToken) return false;
    return withSessionLock(async () => {
      const latest = await sessionStore.load();
      if (!latest || normalizeServer(latest.server) !== this.server) throw new AuthenticationRequiredError(this.session?.server);
      const originalActor = sessionActorId(this.session!);
      if (originalActor && originalActor !== sessionActorId(latest)) throw new AuthenticationRequiredError(latest.server);
      if (latest.refreshToken !== this.session?.refreshToken || latest.accessToken !== this.session?.accessToken) {
        this.session = latest;
        return true;
      }
      const response = await fetch(`${this.server}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: latest.refreshToken }),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 || (response.status === 400 && payload.error?.code === 'INVALID_REFRESH_TOKEN')) {
        await sessionStore.clear();
        throw new AuthenticationRequiredError(latest.server);
      }
      if (!response.ok) throw new ApiRequestError(response.status, `登录续期暂时失败（HTTP ${response.status}），登录凭据已保留，请稍后重试。`, payload.error?.code);
      const session = payload as { accessToken: string; refreshToken: string };
      if (!session.accessToken || !session.refreshToken) throw new Error('登录续期返回无效数据，登录凭据已保留，请稍后重试。');
      this.session = { ...latest, accessToken: session.accessToken, refreshToken: session.refreshToken };
      await sessionStore.save(this.session);
      return true;
    });
  }

  startDevice() { return this.request<{ deviceCode: string; userCode: string; expiresInSeconds: number }>('/auth/device/start', { method: 'POST' }); }
  exchangeDevice(deviceCode: string) { return this.request<{ accessToken: string; refreshToken: string }>('/auth/device/exchange', { method: 'POST', body: JSON.stringify({ deviceCode }) }); }
  me() { return this.request<{ id: string; email: string; displayName?: string | null }>('/auth/me'); }
  project(projectId: string) { return this.request<{ id: string; teamId: string; organizationId: string }>('/projects/' + projectId); }
  workItems(projectId: string) { return this.request<unknown[]>(`/projects/${projectId}/work-items`); }
  createWorkItem(projectId: string, input: Record<string, unknown>, mutationId?: string) { return this.request(`/projects/${projectId}/work-items`, { method: 'POST', headers: mutationHeaders(mutationId), body: JSON.stringify(input) }); }
  workItem(id: string) { return this.request<{ id: string; projectId: string; version: number }>(`/work-items/${id}`); }
  updateWorkItem(id: string, version: number, patch: Record<string, unknown>, mutationId?: string) { return this.request(`/work-items/${id}`, { method: 'PATCH', headers: mutationHeaders(mutationId), body: JSON.stringify({ ...patch, version }) }); }
  async reportWorkItem(id: string, input: Record<string, unknown>, mutationId?: string) {
    const structured = Array.isArray(input.tests) && input.tests.some((test) => test && typeof test === 'object' && (test.outcome !== undefined || test.exitCode !== undefined));
    if (structured && !(await this.serverInfo()).capabilities.includes('structured-tests')) throw new UnsupportedCapabilityError('服务端不支持 structured-tests。请升级服务端后再提交；结构化测试证据已保留，未降级或丢弃。');
    return this.request(`/work-items/${id}/report`, { method: 'POST', headers: mutationHeaders(mutationId), body: JSON.stringify(input) });
  }
  acceptWorkItem(id: string, input: Record<string, unknown>, mutationId?: string) { return this.request(`/work-items/${id}/accept`, { method: 'POST', headers: mutationHeaders(mutationId), body: JSON.stringify(input) }); }
  logWorkItem(id: string, input: Record<string, unknown>, mutationId?: string) { return this.request(`/work-items/${id}/work-logs`, { method: 'POST', headers: mutationHeaders(mutationId), body: JSON.stringify(input) }); }
  correctWorkLog(id: string, logId: string, input: Record<string, unknown>, mutationId?: string) { return this.request(`/work-items/${id}/work-logs/${logId}`, { method: 'PATCH', headers: mutationHeaders(mutationId), body: JSON.stringify(input) }); }
  withdrawWorkLog(id: string, logId: string, input: Record<string, unknown>, mutationId?: string) { return this.request(`/work-items/${id}/work-logs/${logId}`, { method: 'DELETE', headers: mutationHeaders(mutationId), body: JSON.stringify(input) }); }
  serverInfo(): Promise<ServerInfo> {
    return this.capabilitiesPromise ??= this.request<ServerInfo>('/version').catch((error) => {
      if (!(error instanceof ApiRequestError) || error.status !== 404) throw error;
      if (!legacyWarnings.has(this.server)) { console.warn('服务端版本较旧：使用全量同步，升级服务端以启用增量同步与幂等写入。'); legacyWarnings.add(this.server); }
      return { version: 'legacy', protocolVersion: 1, capabilities: [] };
    });
  }
  async sync(projectId: string, cursor?: string) {
    const page = await this.request<{ cursor: string; hasMore: boolean; reset?: boolean; items?: unknown[]; deletedIds?: string[]; changes?: Array<{ sequence: string; id: string; action: 'upsert' | 'delete'; item?: unknown }> }>(`/projects/${projectId}/sync?limit=200${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    const changes = page.changes ?? [];
    return { ...page, items: page.items ?? changes.filter((change) => change.action === 'upsert' && change.item).map((change) => change.item), deletedIds: page.deletedIds ?? changes.filter((change) => change.action === 'delete').map((change) => change.id) };
  }
  workItemEvents(id: string) { return this.request<Array<Record<string, unknown>>>(`/work-items/${id}/events`); }
}
export type ServerInfo = { version: string; commit?: string; protocolVersion: number; capabilities: string[] };
const legacyWarnings = new Set<string>();
function mutationHeaders(id?: string): Record<string, string> { return id ? { 'X-Mutation-ID': id } : {}; }
