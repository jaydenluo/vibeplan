/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectAnalyticsModal, TaskScheduleComparison, type ProjectAnalyticsData } from './ProjectAnalytics.js';

afterEach(cleanup);
it('shows actual contributors independently of current assignment without scoring', () => {
  render(<ProjectAnalyticsModal data={{ ...data, contributors: [{ userId: 'past', displayName: '历史执行者', hours: 2.5, logCount: 2, reportCount: 1, reviewCount: 3 }] }} onClose={vi.fn()} />);
  const table = screen.getByRole('table', { name: '实际协作贡献' });
  expect(within(table).getByText('历史执行者')).toBeTruthy();
  expect(within(table).getByText('2.5 小时')).toBeTruthy();
  expect(screen.getByText(/不用于绩效评分/)).toBeTruthy();
});
const data: ProjectAnalyticsData = {
  taskCount: 4, completedCount: 1, completionRate: 25, averageProgress: 80, inReviewCount: 2,
  overdueCount: 1, blockedCount: 0, staleCount: 0,
  completionTrend: [{ date: '2026-10-04', count: 2 }],
  memberLoads: [
    { assigneeId: 'former', displayName: '离职成员', taskCount: 2, inProgressCount: 1, overdueCount: 1, inReviewCount: 1, remainingEstimateDays: 3, actualHours: 15.5, unknownEstimateCount: 0 },
    { assigneeId: null, taskCount: 1, inProgressCount: 0, overdueCount: 0, inReviewCount: 1, remainingEstimateDays: 0, actualHours: null, unknownEstimateCount: 1 },
  ],
  scheduleComparisons: [{ taskId: 'reopened', estimateDays: 4, actualHours: 15.5, startedAt: '2026-10-01T12:00:00Z', plannedDueDate: '2026-10-04', actualCompletedAt: null, completionHistory: ['2026-10-02T12:00:00Z'], plannedProgress: 100, actualProgress: 25, progressVariance: -75 }],
};

it('distinguishes accepted completion from execution progress and shows event trend', () => {
  render(<ProjectAnalyticsModal data={data} onClose={vi.fn()} />);
  const dialog = screen.getByRole('dialog', { name: '项目健康与成员负载' });
  expect(within(dialog).getByText('验收完成率').previousElementSibling?.textContent).toBe('25%');
  expect(within(dialog).getByText('执行进度').previousElementSibling?.textContent).toBe('80%');
  const trend = screen.getByRole('table', { name: '近 7 天验收批准趋势（UTC）' });
  expect(within(trend).getByText('2026-10-04')).toBeTruthy();
  expect(within(trend).getByText('2')).toBeTruthy();
});

it('shows former members, unassigned tasks, missing hours and separate workload units', () => {
  render(<ProjectAnalyticsModal data={data} onClose={vi.fn()} />);
  const table = screen.getByRole('table', { name: '成员当前负载' });
  expect(within(table).getByText('离职成员')).toBeTruthy();
  expect(within(table).getByText('未分配')).toBeTruthy();
  expect(within(table).getByText('3 天')).toBeTruthy();
  expect(within(table).getByText('15.5 小时')).toBeTruthy();
  expect(within(table).getByText('未记录')).toBeTruthy();
  expect(within(table).getByText('1 个任务未估算')).toBeTruthy();
});

it('closes by button or Escape without closing when clicking dialog content', () => {
  const onClose = vi.fn();
  render(<ProjectAnalyticsModal data={data} onClose={onClose} />);
  fireEvent.mouseDown(screen.getByRole('dialog'));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('shows reopened history while current completion remains unrecorded', () => {
  render(<TaskScheduleComparison taskId="reopened" data={data} />);
  expect(screen.getByText('实际完成').nextElementSibling?.textContent).toBe('未记录');
  expect(screen.getByText('实际开始').nextElementSibling?.textContent).toContain('2026-10-01');
  expect(screen.getByText('4 天')).toBeTruthy();
  expect(screen.getByText('15.5 小时')).toBeTruthy();
  expect(screen.getByText('-75 个百分点')).toBeTruthy();
  expect(screen.getByText('历史验收批准')).toBeTruthy();
  expect(screen.getByText('2026-10-02 12:00 UTC')).toBeTruthy();
});

it('provides empty project and missing schedule states without inventing values', () => {
  render(<><ProjectAnalyticsModal data={{ ...data, memberLoads: [], taskCount: 0, scheduleComparisons: [] }} onClose={vi.fn()} /><TaskScheduleComparison taskId="missing" data={{ ...data, scheduleComparisons: [] }} /></>);
  expect(screen.getByText('当前项目暂无任务。')).toBeTruthy();
  expect(screen.getByText('暂无当前负载。')).toBeTruthy();
  expect(screen.getByText('计划与实际信息未记录。')).toBeTruthy();
});
