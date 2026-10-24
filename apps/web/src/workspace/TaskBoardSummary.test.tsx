/** @vitest-environment jsdom */
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskBoardSummary } from './ProjectManagementPage.js';

it('summarizes visible task count, active work, risks, and average progress', () => {
  render(<TaskBoardSummary items={[
    { id: 'one', title: '接口开发', type: 'feature', status: 'in_progress', priority: 'P1', progress: 40, estimate: 3, riskFlags: ['due_soon'], parentId: null },
    { id: 'two', title: '测试补充', type: 'bug', status: 'done', priority: 'P2', progress: 100, estimate: 1, riskFlags: [], parentId: 'one' },
  ]} />);

  expect(screen.getByText('2 项任务')).toBeTruthy();
  expect(screen.getByText('1 项进行中')).toBeTruthy();
  expect(screen.getByText('1 项风险')).toBeTruthy();
  expect(screen.getByText('平均进度 70%')).toBeTruthy();
});
