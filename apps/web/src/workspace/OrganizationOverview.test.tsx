/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrganizationOverview } from './OrganizationOverview.js';
import { apiRequest, showMessage } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiRequest: vi.fn(), showMessage: vi.fn() }));

const overview = {
  summary: { projectCount: 2, taskCount: 12, averageProgress: 48, inProgressCount: 4, inReviewCount: 2, blockedCount: 1, overdueCount: 3, staleCount: 1 },
  statusDistribution: [{ status: 'backlog', count: 1 }, { status: 'ready', count: 2 }, { status: 'in_progress', count: 4 }, { status: 'blocked', count: 1 }, { status: 'in_review', count: 2 }, { status: 'done', count: 2 }],
  completionTrend: [{ date: '2026-10-07', count: 0 }, { date: '2026-10-08', count: 1 }, { date: '2026-10-09', count: 0 }, { date: '2026-10-10', count: 2 }, { date: '2026-10-11', count: 0 }, { date: '2026-10-12', count: 1 }, { date: '2026-10-13', count: 0 }],
  projects: [{ id: 'project-a', name: '核心平台', progress: 60, taskCount: 8, overdueCount: 2, blockedCount: 1, staleCount: 0, risk: 'critical' }, { id: 'project-b', name: '移动端', progress: 24, taskCount: 4, overdueCount: 0, blockedCount: 0, staleCount: 1, risk: 'watch' }],
};

describe('OrganizationOverview', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it('shows action counts, project risks, and compact charts from the organization overview', async () => {
    vi.mocked(apiRequest).mockResolvedValue(overview);
    render(<OrganizationOverview organizationId="org-1" onOpenProjects={vi.fn()} onOpenApprovals={vi.fn()} onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: '工作台' })).toBeTruthy());
    expect(screen.getByRole('button', { name: /进行中 4/ })).toBeTruthy();
    expect(screen.getByText('核心平台')).toBeTruthy();
    expect(screen.getByRole('img', { name: '任务状态分布' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '近 7 天完成趋势' })).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledWith('/organizations/org-1/overview');
  });

  it('opens projects and approvals from the relevant action areas', async () => {
    const onOpenProjects = vi.fn();
    const onOpenApprovals = vi.fn();
    const onOpenProject = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue(overview);
    render(<OrganizationOverview organizationId="org-1" onOpenProjects={onOpenProjects} onOpenApprovals={onOpenApprovals} onOpenProject={onOpenProject} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /查看 核心平台 项目/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /进行中 4/ }));
    fireEvent.click(screen.getByRole('button', { name: /待审批 2/ }));
    fireEvent.click(screen.getByRole('button', { name: /查看 核心平台 项目/ }));
    expect(onOpenProjects).toHaveBeenCalledOnce();
    expect(onOpenApprovals).toHaveBeenCalledOnce();
    expect(onOpenProject).toHaveBeenCalledWith('project-a');
  });

  it('keeps request failures out of the page while retaining a neutral state', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Request failed with 404'));
    render(<OrganizationOverview organizationId="org-1" onOpenProjects={vi.fn()} onOpenApprovals={vi.fn()} onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('暂无组织总览数据。')).toBeTruthy());
    expect(showMessage).not.toHaveBeenCalledWith('Request failed with 404', 'error');
  });
});
