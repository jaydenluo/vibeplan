/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectManagementPage } from './ProjectManagementPage.js';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps author hours separate from estimated handoff days and filters actual records by date', async () => {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = String(input);
    const payload = path.includes('/contributors') ? { members: [{ userId: 'author', displayName: '日志作者', hours: 8, logCount: 1, reportCount: 2, reviewCount: 0, testCount: 4 }] }
      : path.endsWith('/members') ? [{ userId: 'assignee', displayName: '现任负责人', email: 'assignee@example.com', role: 'member' }]
      : path.endsWith('/work-items') ? [{ id: 'task', title: '交接任务', type: 'feature', status: 'in_progress', priority: 'P2', progress: 50, estimate: 4, actualHours: 8, assigneeId: 'assignee', version: 1 }]
      : path.endsWith('/health') ? null : [];
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ProjectManagementPage projects={[{ id: 'project', name: '项目', slug: 'project', teamId: 'team' }]} activeProjectId="project" onBack={vi.fn()} onSelectProject={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByText('交接任务').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: '成员贡献' }));
  const dialog = screen.getByRole('dialog', { name: '成员贡献统计' });
  await waitFor(() => expect(within(dialog).getByText('日志作者')).toBeTruthy());
  const actual = within(dialog).getByRole('table', { name: '实际协作贡献' });
  expect(within(actual).getByText('8 小时')).toBeTruthy();
  expect(within(actual).queryByText('现任负责人')).toBeNull();
  expect(within(dialog).getAllByText('推算贡献（计划天数）').length).toBeGreaterThan(0);
  expect(within(actual).getByText('测试记录')).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText('贡献开始日期'), { target: { value: '2026-10-01' } });
  fireEvent.change(within(dialog).getByLabelText('贡献结束日期'), { target: { value: '2026-10-05' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '应用日期范围' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects\/project\/contributors\?from=2026-10-01&to=2026-10-05$/), expect.anything()));
});
