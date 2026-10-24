/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskAcceptanceActions } from './TaskAcceptanceActions.js';
import { apiRequest, showMessage } from '../api/client.js';
vi.mock('../api/client.js', () => ({ apiRequest: vi.fn(), showMessage: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('requires a rejection reason and submits the current version', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ canReview: true, canContribute: true });
  const onUpdated = vi.fn();
  render(<TaskAcceptanceActions item={{ id: 'task', status: 'in_review', version: 4 }} onUpdated={onUpdated} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '退回修改' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '退回修改' }));
  expect(showMessage).toHaveBeenCalledWith('请填写退回原因。', 'error');
  expect(apiRequest).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('验收说明 / 退回原因'), { target: { value: '需要补充测试' } });
  vi.mocked(apiRequest).mockResolvedValue({ id: 'task', status: 'in_progress', version: 5 });
  fireEvent.click(screen.getByRole('button', { name: '退回修改' }));
  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress', version: 5 })));
  expect(apiRequest).toHaveBeenLastCalledWith('/work-items/task/accept', expect.objectContaining({ body: JSON.stringify({ version: 4, decision: 'rejected', comment: '需要补充测试' }) }));
});

it('does not expose approval controls to a contributor', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ canReview: false, canContribute: true });
  render(<TaskAcceptanceActions item={{ id: 'task', status: 'in_review', version: 4 }} onUpdated={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('等待有审核权限的成员验收。')).toBeTruthy());
  expect(screen.queryByRole('button', { name: '批准完成' })).toBeNull();
});

it('keeps an unsuccessful acceptance visible without claiming completion', async () => {
  vi.mocked(apiRequest).mockResolvedValueOnce({ canReview: true, canContribute: true }).mockRejectedValueOnce(new Error('验收项尚未全部通过'));
  const onUpdated = vi.fn();
  render(<TaskAcceptanceActions item={{ id: 'task', status: 'in_review', version: 4 }} onUpdated={onUpdated} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '批准完成' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '批准完成' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(onUpdated).not.toHaveBeenCalled();
});
