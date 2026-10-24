/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TodayWork } from './TodayWork.js';
import { apiRequest } from '../api/client.js';
vi.mock('../api/client.js', () => ({ apiRequest: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it('loads organization work with explanation and opens the exact task', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ inProgress: [], ready: [], blocked: [{ id: 'task', projectId: 'project', title: '解决依赖', status: 'blocked', priority: 'P1', dueDate: null, reason: '前置任务未完成' }], inReview: [], next: null });
  const onOpenTask = vi.fn();
  render(<TodayWork organizationId="org" onOpenTask={onOpenTask} />);
  await waitFor(() => expect(screen.getByText('前置任务未完成')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /解决依赖/ }));
  expect(onOpenTask).toHaveBeenCalledWith('project', 'task');
  expect(apiRequest).toHaveBeenCalledWith('/organizations/org/my-work');
});
it('renders the API review queue and a non-null next recommendation', async () => {
  const task = { id: 'next', projectId: 'project', title: '建议任务', status: 'ready', priority: 'P1', dueDate: null, reason: '按优先级推荐' };
  vi.mocked(apiRequest).mockResolvedValue({ inProgress: [], ready: [], blocked: [], inReview: [{ ...task, id: 'review', title: '审核任务', status: 'in_review', reason: '待你审核' }], next: task });
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('建议任务')).toBeTruthy());
  expect(screen.getByText('审核任务')).toBeTruthy();
});

it('does not render the API error text when loading fails', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('Request failed with 404'));
  render(<TodayWork organizationId="org" onOpenTask={vi.fn()} />);

  await waitFor(() => expect(screen.getByText('暂无今日工作数据。')).toBeTruthy());
  expect(screen.queryByText('Request failed with 404')).toBeNull();
});
