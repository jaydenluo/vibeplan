/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TodayWork } from './TodayWork.js';
import { apiRequest } from '../api/client.js';
vi.mock('../api/client.js', () => ({ apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

function task(id: string, extra = {}) {
  return { id, projectId: 'project', projectName: 'Vibe Plan', title: `任务 ${id}`, status: 'in_progress', priority: 'P1', dueDate: '2099-11-06', reason: '优先继续已开始的任务', ...extra };
}
function queues(extra = {}) { return { inProgress: [], ready: [], blocked: [], inReview: [], next: null, ...extra }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function panel() { return within(screen.getByRole('tabpanel')); }

it('shows category counts and project metadata while retaining a single recommendation shortcut', async () => {
  const next = task('next', { title: '新增 Markdown 使用教程' });
  vi.mocked(apiRequest).mockResolvedValue(queues({ inProgress: [next], ready: [task('ready')], inReview: [task('review')], next }));
  const open = vi.fn();
  render(<TodayWork organizationId="org" onOpenTask={open} />);
  const tab = await screen.findByRole('tab', { name: '进行中 1' });
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('tab', { name: '已阻塞 0' })).toBeTruthy();
  expect(panel().getByText('Vibe Plan')).toBeTruthy();
  expect(panel().getByText('11-06')).toBeTruthy();
  expect(panel().queryByText('优先继续已开始的任务')).toBeNull();
  expect(screen.getAllByText('建议下一步')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /查看建议任务：新增 Markdown 使用教程/ }));
  expect(open).toHaveBeenCalledWith('project', 'next');
  fireEvent.click(panel().getByRole('button', { name: /新增 Markdown 使用教程/ }));
  expect(open).toHaveBeenLastCalledWith('project', 'next');
  fireEvent.click(screen.getByRole('tab', { name: '待验收 1' }));
  expect(panel().getByText('任务 review')).toBeTruthy();
  expect(panel().queryByText('新增 Markdown 使用教程')).toBeNull();
});

it('defaults to review before blocked and ready when no tasks are in progress', async () => {
  vi.mocked(apiRequest).mockResolvedValue(queues({ ready: [task('ready')], blocked: [task('blocked')], inReview: [task('review')] }));
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  expect((await screen.findByRole('tab', { name: '待验收 1' })).getAttribute('aria-selected')).toBe('true');
  expect(panel().getByText('任务 review')).toBeTruthy();
  expect(screen.queryByText('建议下一步')).toBeNull();
});

it('opens blocked tasks and makes the complete dependency explanation expandable', async () => {
  const reason = '前置任务未完成：数据库连接、权限检查、迁移验证与发布确认';
  vi.mocked(apiRequest).mockResolvedValue(queues({ blocked: [task('blocked', { status: 'blocked', dueDate: null, reason })] }));
  const open = vi.fn();
  render(<TodayWork organizationId="org" onOpenTask={open} />);
  await screen.findByRole('tab', { name: '已阻塞 1', selected: true });
  expect(panel().getByText('未设截止')).toBeTruthy();
  const summary = panel().getByText('阻塞原因').closest('summary')!;
  fireEvent.click(summary);
  expect(summary.closest('details')!.open).toBe(true);
  expect(within(summary.closest('details')!).getAllByText(reason)).toHaveLength(2);
  fireEvent.click(panel().getByRole('button', { name: /任务 blocked/ }));
  expect(open).toHaveBeenCalledWith('project', 'blocked');
});

it('shows six rows initially and expands the queue without changing its order', async () => {
  vi.mocked(apiRequest).mockResolvedValue(queues({ inProgress: Array.from({ length: 8 }, (_, i) => task(String(i))) }));
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  await screen.findByRole('tab', { name: '进行中 8' });
  expect(panel().getAllByRole('listitem')).toHaveLength(6);
  expect(panel().queryByText('任务 6')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开全部 8 项' }));
  expect(panel().getAllByRole('listitem').map(row => within(row).getByRole('button').getAttribute('aria-label'))).toEqual(Array.from({ length: 8 }, (_, i) => `查看任务：任务 ${i}`));
  fireEvent.click(screen.getByRole('button', { name: '收起' }));
  expect(panel().getAllByRole('listitem')).toHaveLength(6);
});

it('supports arrow, Home and End keys in category navigation', async () => {
  vi.mocked(apiRequest).mockResolvedValue(queues({ inProgress: [task('progress')], ready: [task('ready')] }));
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  const first = await screen.findByRole('tab', { name: '进行中 1' });
  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const ready = screen.getByRole('tab', { name: '可开始 1' });
  expect(ready.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(ready);
  fireEvent.keyDown(ready, { key: 'End' });
  expect(screen.getByRole('tab', { name: '待验收 0' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(first.getAttribute('aria-selected')).toBe('true');
});

it('retains rows and selection during refresh and explains a refresh failure', async () => {
  const pending = deferred<unknown>();
  vi.mocked(apiRequest).mockResolvedValueOnce(queues({ inProgress: [task('progress')], ready: [task('ready')] })).mockReturnValueOnce(pending.promise);
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  await screen.findByRole('tab', { name: '可开始 1' });
  fireEvent.click(screen.getByRole('tab', { name: '可开始 1' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新工作' }));
  expect(panel().getByText('任务 ready')).toBeTruthy();
  expect(screen.getByRole('tab', { name: '可开始 1', selected: true })).toBeTruthy();
  expect(screen.getByText('正在更新…')).toBeTruthy();
  await act(async () => pending.reject(new Error('Request failed with 500')));
  expect(screen.getByText('更新失败，当前显示上次加载的内容。')).toBeTruthy();
  expect(panel().getByText('任务 ready')).toBeTruthy();
  expect(screen.queryByText('Request failed with 500')).toBeNull();
});

it('keeps the chosen category when an automatic focus refresh succeeds', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce(queues({ inProgress: [task('p')], ready: [task('r')] })).mockResolvedValueOnce(queues({ inProgress: [task('p')], ready: [task('r2')] }));
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  fireEvent.click(await screen.findByRole('tab', { name: '可开始 1' }));
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText('任务 r2')).toBeTruthy();
  expect(screen.getByRole('tab', { name: '可开始 1', selected: true })).toBeTruthy();
});

it('immediately hides the previous organization and ignores its late response', async () => {
  const pending = deferred<unknown>();
  const newOrg = deferred<unknown>();
  vi.mocked(apiRequest).mockResolvedValueOnce(queues({ inProgress: [task('old')] })).mockReturnValueOnce(pending.promise).mockReturnValueOnce(newOrg.promise);
  const { rerender } = render(<TodayWork organizationId="old" onOpenTask={vi.fn()} />);
  await screen.findByText('任务 old');
  fireEvent.click(screen.getByRole('button', { name: '刷新工作' }));
  rerender(<TodayWork organizationId="new" onOpenTask={vi.fn()} />);
  expect(screen.queryByText('任务 old')).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
  await act(async () => pending.resolve(queues({ inProgress: [task('late')] })));
  expect(screen.queryByText('任务 late')).toBeNull();
  await act(async () => newOrg.resolve(queues({ ready: [task('new')] })));
  expect(screen.getByRole('tab', { name: '可开始 1', selected: true })).toBeTruthy();
  expect(panel().getByText('任务 new')).toBeTruthy();
});

it('distinguishes initial load failure from an empty queue and supports retry', async () => {
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Request failed with 404')).mockResolvedValueOnce(queues());
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  expect(await screen.findByText('今日工作加载失败，请重试。')).toBeTruthy();
  expect(screen.queryByText('Request failed with 404')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('当前没有需要你处理的任务。')).toBeTruthy();
  expect(screen.queryByText('今日工作加载失败，请重试。')).toBeNull();
});

it('does not fetch without an organization and hides prior content when it is cleared', async () => {
  vi.mocked(apiRequest).mockResolvedValue(queues({ inProgress: [task('old')] }));
  const { rerender } = render(<TodayWork organizationId="" onOpenTask={vi.fn()} />);
  expect(apiRequest).not.toHaveBeenCalled();
  expect(screen.getByText('选择组织后查看今日工作。')).toBeTruthy();
  rerender(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  await screen.findByText('任务 old');
  rerender(<TodayWork organizationId="" onOpenTask={vi.fn()} />);
  expect(screen.queryByText('任务 old')).toBeNull();
  expect(screen.getByText('选择组织后查看今日工作。')).toBeTruthy();
});

it('refreshes every minute and stops the timer when unmounted', async () => {
  vi.useFakeTimers();
  vi.mocked(apiRequest).mockResolvedValue(queues({ inProgress: [task('timer')] }));
  const { unmount } = render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  await act(async () => {});
  expect(screen.getByText('任务 timer')).toBeTruthy();
  expect(apiRequest).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(apiRequest).toHaveBeenCalledTimes(2);
  expect(screen.getByText('任务 timer')).toBeTruthy();
  unmount();
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(apiRequest).toHaveBeenCalledTimes(2);
});
