import { describe, expect, it, vi } from 'vitest';
import { collectStatus, renderStatus, type StatusDependencies } from './status.js';

const root = '/workspace/example';

function dependencies(overrides: Partial<StatusDependencies> = {}): StatusDependencies {
  return {
    cliVersion: '0.1.5',
    loadSession: vi.fn().mockResolvedValue({ server: 'https://vibeplan.example/api', accessToken: 'access', refreshToken: 'refresh' }),
    createClient: vi.fn(() => ({
      me: vi.fn().mockResolvedValue({ id: 'user-1', email: 'owner@example.com', displayName: '项目负责人' }),
      workItems: vi.fn().mockResolvedValue([
        { id: 'task-1', title: '修复登录', status: 'in_progress', priority: 'P1', dueDate: '2026-10-05' },
        { id: 'task-2', title: '完善文档', status: 'ready', priority: 'P2', dueDate: null },
        { id: 'task-3', title: '发布版本', status: 'in_review', priority: 'P1', dueDate: '2026-10-04' },
      ]),
    })),
    loadProjectConfig: vi.fn().mockReturnValue({ server: 'https://vibeplan.example/api', projectId: 'project-1', organizationId: 'organization-1', teamId: 'team-1' }),
    daemonStatus: vi.fn().mockReturnValue({ running: true, pid: 2468 }),
    listOutbox: vi.fn().mockReturnValue([{ id: 'queued', type: 'work-item.update', payload: {}, createdAt: '2026-10-04T00:00:00.000Z', retryCount: 0 }]),
    gitState: vi.fn().mockReturnValue({ branch: 'main', commit: 'abc1234', dirty: true }),
    lastLogUpdatedAt: vi.fn().mockReturnValue('2026-10-04T08:00:00.000Z'),
    ...overrides,
  };
}

describe('vibeplan status', () => {
  it('collects account, project, sync, git, and prioritized task summary', async () => {
    const status = await collectStatus(root, dependencies());

    expect(status).toMatchObject({
      cliVersion: '0.1.5',
      session: { state: 'authenticated', email: 'owner@example.com', displayName: '项目负责人', server: 'https://vibeplan.example/api' },
      project: { projectId: 'project-1', organizationId: 'organization-1', teamId: 'team-1' },
      daemon: { running: true, pid: 2468 },
      sync: { pendingEvents: 1, failedEvents: 0, lastLogUpdatedAt: '2026-10-04T08:00:00.000Z' },
      git: { branch: 'main', commit: 'abc1234', dirty: true },
      tasks: { total: 3, byStatus: { in_progress: 1, ready: 1, in_review: 1 }, next: { id: 'task-1', title: '修复登录', priority: 'P1' } },
    });
    expect(renderStatus(status)).toContain('项目推荐:   修复登录 · P1 · 10月5日');
    expect(JSON.stringify(status)).not.toContain('access');
    expect(JSON.stringify(status)).not.toContain('refresh');
  });

  it('reports an absent session without requesting remote task data', async () => {
    const createClient = vi.fn();
    const status = await collectStatus(root, dependencies({ loadSession: vi.fn().mockResolvedValue(undefined), createClient }));

    expect(status.session).toEqual({ state: 'not_logged_in' });
    expect(status.tasks).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(renderStatus(status)).toContain('会话状态:   未登录');
    expect(renderStatus(status)).toContain('服务端:     https://vibeplan.example/api');
  });

  it('turns an expired remote session into an actionable login message', async () => {
    const status = await collectStatus(root, dependencies({
      createClient: vi.fn(() => ({ me: vi.fn().mockRejectedValue(new Error('Authentication is required.')), workItems: vi.fn() })),
    }));

    expect(status.session).toMatchObject({ state: 'unavailable', message: '登录已失效，请运行 vibeplan login。' });
    expect(renderStatus(status)).toContain('登录已失效，请运行 vibeplan login。');
  });
});
