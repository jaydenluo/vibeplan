/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskReportForm } from './TaskReportForm.js';
import { apiRequest, showMessage } from '../api/client.js';
vi.mock('../api/client.js', () => ({ apiBase: '/api', apiRequest: vi.fn(), showMessage: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });
const item = { id: 'task', version: 4, acceptanceItems: [{ id: 'criterion', text: '边界测试通过' }] };
it('submits structured failed evidence with criterion IDs and retains a conflict draft', async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error('版本冲突'));
  const props = { item, accountId: 'account', onUpdated: vi.fn() };
  const view = render(<TaskReportForm {...props} />);
  fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: '边界测试失败' } });
  fireEvent.change(screen.getByLabelText('执行结果'), { target: { value: 'failed' } });
  fireEvent.change(screen.getByLabelText('改动文件'), { target: { value: 'src/task.ts' } });
  fireEvent.click(screen.getByRole('button', { name: '添加测试' }));
  fireEvent.change(screen.getByLabelText('测试命令 1'), { target: { value: 'pnpm test' } });
  fireEvent.change(screen.getByLabelText('测试结果 1'), { target: { value: '1 failed' } });
  fireEvent.change(screen.getByLabelText('测试状态 1'), { target: { value: 'failed' } });
  fireEvent.change(screen.getByLabelText('验收结果 边界测试通过'), { target: { value: '边界用例失败' } });
  fireEvent.click(screen.getByRole('button', { name: '提交执行报告' }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).toBeNull();
  const init = vi.mocked(apiRequest).mock.calls[0]![1]!;
  expect(JSON.parse(String(init.body))).toMatchObject({ version: 4, outcome: 'failed', changedFiles: ['src/task.ts'], tests: [{ command: 'pnpm test', result: '1 failed', outcome: 'failed' }], criterionResults: [{ acceptanceItemId: 'criterion', result: '边界用例失败' }] });
  view.unmount();
  render(<TaskReportForm {...props} item={{ ...item, version: 5 }} />);
  expect((screen.getByLabelText('执行说明') as HTMLTextAreaElement).value).toBe('边界测试失败');
});
it('rejects non-http evidence and isolates draft accounts', async () => {
  const view = render(<TaskReportForm item={item} accountId="account-a" onUpdated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('执行说明'), { target: { value: 'private draft' } });
  fireEvent.click(screen.getByRole('button', { name: '添加证据' }));
  fireEvent.change(screen.getByLabelText('证据链接 1'), { target: { value: 'javascript:alert(1)' } });
  fireEvent.click(screen.getByRole('button', { name: '提交执行报告' }));
  expect(showMessage).toHaveBeenCalledWith('证据链接必须使用 HTTP 或 HTTPS。', 'error');
  expect(apiRequest).not.toHaveBeenCalled();
  view.unmount();
  render(<TaskReportForm item={item} accountId="account-b" onUpdated={vi.fn()} />);
  expect((screen.getByLabelText('执行说明') as HTMLTextAreaElement).value).toBe('');
});

it('shows validation errors through the global message center', async () => {
  render(<TaskReportForm item={item} accountId="account" onUpdated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '提交执行报告' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(showMessage).toHaveBeenCalledWith('请填写执行说明。', 'error');
});
