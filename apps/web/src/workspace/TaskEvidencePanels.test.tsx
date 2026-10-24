/** @vitest-environment jsdom */
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ExecutionEvidence, TaskHistory } from './TaskEvidencePanels.js';
afterEach(cleanup);
it('preserves a previous-cycle report without claiming pending acceptance', () => {
  render(<ExecutionEvidence acceptanceCycle={2} events={[{ action: 'report', createdAt: '2026-10-04T00:00:00Z', payload: { outcome: 'success', acceptanceCycle: 1, evidence: [{ label: '历史证据', url: 'https://example.com/previous' }] } }]} />);
  expect(screen.getByText(/历史交付报告/)).toBeTruthy();
  expect(screen.queryByText('已提交交付报告，等待验收。')).toBeNull();
  expect(screen.getByRole('link', { name: '历史证据' })).toBeTruthy();
});
it('renders historical unsafe evidence as text without an active link', () => {
  render(<ExecutionEvidence events={[{ action: 'report', createdAt: '2026-10-04T00:00:00Z', payload: { evidence: [{ label: '旧证据', url: 'javascript:alert(1)' }] } }]} />);
  expect(screen.getByText(/旧证据/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
});
it('shows failed execution evidence without claiming successful delivery', () => {
  render(<ExecutionEvidence events={[{ action: 'report', createdAt: '2026-10-04T00:00:00Z', payload: { outcome: 'failed', evidence: [{ label: '日志', url: 'https://example.com/log' }], remainingIssues: ['修复边界测试'], risks: ['发布受阻'] } }]} />);
  expect(screen.getByText('本次执行失败，尚未提交验收。')).toBeTruthy();
  expect(screen.getByText('修复边界测试')).toBeTruthy();
  expect(screen.getByRole('link', { name: '日志' }).getAttribute('href')).toBe('https://example.com/log');
});
it('shows the actor and field differences and labels incomplete legacy history', () => {
  render(<TaskHistory events={[{ action: 'updated', actorName: '李明', createdAt: '2026-10-04T00:00:00Z', payload: { changes: { title: { before: '旧标题', after: '新标题' } }, changeReason: '范围调整' } }, { action: 'updated', createdAt: '2026-10-03T00:00:00Z', payload: {} }]} />);
  expect(screen.getByText('字段变更')).toBeTruthy();
  expect(screen.getAllByText('更新任务')).toHaveLength(2);
  expect(screen.queryByText('旧标题 → 新标题')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: /更新任务.*李明/ })[0]);
  expect(screen.getByText('旧标题 → 新标题')).toBeTruthy();
  expect(screen.getByText('变更原因：范围调整')).toBeTruthy();
});

it('filters history by execution reports and keeps newest records first', () => {
  render(<TaskHistory events={[
    { id: 'report', action: 'report', actorName: 'AI', createdAt: '2026-10-04T00:00:00Z', payload: { summary: '测试通过' } },
    { id: 'update', action: 'updated', actorName: '李明', createdAt: '2026-10-05T00:00:00Z', payload: { changes: {} } },
  ]} />);
  const entries = document.querySelectorAll('.task-history-event');
  expect(entries[0].textContent).toContain('更新任务');
  fireEvent.click(screen.getByRole('button', { name: '执行报告' }));
  expect(screen.getByText('测试通过')).toBeTruthy();
  expect(screen.queryByText('更新任务')).toBeNull();
});
