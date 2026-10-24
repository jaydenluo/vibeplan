import { describe, expect, it } from 'vitest';
import { calculateProjectMetrics, type MetricsTask, type MetricsEvent } from './metrics.js';

const now = new Date('2026-10-04T12:00:00Z');
const task = (id: string, values: Partial<MetricsTask> = {}): MetricsTask => ({ id, status: 'backlog', progress: 0, ...values });
const approval = (workItemId: string, createdAt: string): MetricsEvent => ({ workItemId, action: 'acceptance', payload: { decision: 'approved' }, createdAt });

describe('project metrics', () => {
  it('counts active leaves once and only counts approved done tasks as completed', () => {
    const result = calculateProjectMetrics([
      task('parent', { status: 'in_progress', progress: 80 }),
      task('middle', { parentId: 'parent' }),
      task('done', { parentId: 'middle', status: 'done', progress: 100 }),
      task('review', { parentId: 'parent', status: 'in_review', progress: 100 }),
      task('manual', { status: 'in_progress', progress: 100 }),
      task('legacy', { status: 'done', progress: 100 }),
      task('cancelled', { status: 'cancelled', progress: 100 }),
    ], [approval('done', '2026-10-03T01:00:00Z')], now);
    expect(result).toMatchObject({ taskCount: 4, completedCount: 1, completionRate: 25, inReviewCount: 1 });
  });

  it('groups seven days of approval events by UTC day and retains reopened completions', () => {
    const result = calculateProjectMetrics([task('reopened', { status: 'in_progress' }), task('done', { status: 'done' })], [
      approval('reopened', '2026-09-28T23:00:00-02:00'),
      approval('done', '2026-10-02T11:00:00Z'),
      approval('done', '2026-10-04T10:00:00Z'),
      approval('done', '2026-10-04T13:00:00Z'),
      approval('done', '2026-09-27T23:59:59Z'),
      approval('unknown', '2026-10-03T00:00:00Z'),
      { workItemId: 'done', action: 'acceptance', payload: { decision: 'rejected' }, createdAt: '2026-10-03T00:00:00Z' },
    ], now);
    expect(result.completionTrend).toEqual([
      { date: '2026-09-28', count: 0 }, { date: '2026-09-29', count: 1 },
      { date: '2026-09-30', count: 0 }, { date: '2026-10-01', count: 0 },
      { date: '2026-10-02', count: 1 }, { date: '2026-10-03', count: 0 },
      { date: '2026-10-04', count: 1 },
    ]);
    expect(result.scheduleComparisons.find((row) => row.taskId === 'reopened')).toMatchObject({ actualCompletedAt: null, completionHistory: ['2026-09-29T01:00:00.000Z'] });
    expect(result.scheduleComparisons.find((row) => row.taskId === 'done')?.actualCompletedAt).toBe('2026-10-04T10:00:00.000Z');
  });

  it('keeps current assignee loads and remaining days distinct from actual hours', () => {
    const result = calculateProjectMetrics([
      task('one', { status: 'in_progress', assigneeId: 'former-member', progress: 25, estimate: 4, actualHours: '15.50', dueDate: '2026-10-03' }),
      task('two', { status: 'in_review', assigneeId: 'former-member', progress: 100, estimate: 2, actualHours: 1 }),
      task('three', { status: 'blocked', assigneeId: null, estimate: null }),
      task('four', { status: 'done', assigneeId: 'former-member', estimate: 2, actualHours: 7 }),
    ], [approval('four', '2026-10-02T01:00:00Z')], now);
    expect(result.memberLoads).toContainEqual({ assigneeId: 'former-member', taskCount: 2, inProgressCount: 1, overdueCount: 1, inReviewCount: 1, remainingEstimateDays: 3, actualHours: 16.5, unknownEstimateCount: 0 });
    expect(result.memberLoads).toContainEqual({ assigneeId: null, taskCount: 1, inProgressCount: 0, overdueCount: 0, inReviewCount: 0, remainingEstimateDays: 0, actualHours: null, unknownEstimateCount: 1 });
  });

  it('compares schedule progress and leaves missing records null', () => {
    const result = calculateProjectMetrics([
      task('scheduled', { status: 'in_progress', estimate: 8, actualHours: 40, progress: 20, startedAt: new Date('2026-10-01T00:00:00Z'), dueDate: '2026-10-07' }),
      task('missing'),
      task('today', { status: 'in_progress', dueDate: '2026-10-04' }),
    ], [], now);
    expect(result.scheduleComparisons[0]).toMatchObject({ estimateDays: 8, actualHours: 40, startedAt: '2026-10-01T00:00:00.000Z', plannedDueDate: '2026-10-07', plannedProgress: 50, actualProgress: 20, progressVariance: -30 });
    expect(result.scheduleComparisons[1]).toMatchObject({ estimateDays: null, actualHours: null, startedAt: null, plannedDueDate: null, plannedProgress: null, progressVariance: null });
    expect(result.overdueCount).toBe(0);
  });

  it('returns zero metrics and a seven day trend for an empty project', () => {
    expect(calculateProjectMetrics([], [], now)).toMatchObject({ taskCount: 0, completedCount: 0, completionRate: 0, averageProgress: 0, memberLoads: [], scheduleComparisons: [] });
    expect(calculateProjectMetrics([], [], now).completionTrend).toHaveLength(7);
  });

  it('uses trusted progress normalization and resolved dependency risks', () => {
    const result = calculateProjectMetrics([
      task('ready', { status: 'ready', progress: 99, estimate: 2 }),
      task('working', { status: 'in_progress', progress: 100, estimate: 2, riskFlags: ['blocked'] }),
      task('review', { status: 'in_review', progress: 1, estimate: 2 }),
    ], [], now);
    expect(result.blockedCount).toBe(1);
    expect(result.scheduleComparisons.map((row) => row.actualProgress)).toEqual([0, 99, 100]);
    expect(result.memberLoads[0]?.remainingEstimateDays).toBeCloseTo(2.02);
  });
});
