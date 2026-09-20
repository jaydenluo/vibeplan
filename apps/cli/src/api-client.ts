import type { Session } from './auth.js';

export class ApiClient {
  constructor(private readonly server: string, private readonly session?: Session) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.server.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `API request failed: ${response.status}`);
    }
    return payload as T;
  }

  startDevice() { return this.request<{ deviceCode: string; userCode: string; expiresInSeconds: number }>('/auth/device/start', { method: 'POST' }); }
  exchangeDevice(deviceCode: string) { return this.request<{ accessToken: string; refreshToken: string }>('/auth/device/exchange', { method: 'POST', body: JSON.stringify({ deviceCode }) }); }
  me() { return this.request<{ id: string; email: string }>('/auth/me'); }
  project(projectId: string) { return this.request<{ id: string; teamId: string }>('/projects/' + projectId); }
  workItems(projectId: string) { return this.request<unknown[]>(`/projects/${projectId}/work-items`); }
  updateWorkItem(id: string, version: number, patch: Record<string, unknown>) { return this.request(`/work-items/${id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, version }) }); }
}
