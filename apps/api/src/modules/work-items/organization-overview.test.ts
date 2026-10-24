import { describe, expect, it } from 'vitest';
import { aggregateOrganizationOverview } from './organization-overview.js';

const trend = (counts: number[]) => counts.map((count, index) => ({ date: `2026-10-0${index + 1}`, count }));

describe('organization overview', () => {
  it('aggregates visible project progress, action counts, status distribution, and completion trend', () => {
    const overview = aggregateOrganizationOverview([
      {
        id: 'project-a',
        name: '核心平台',
        items: [
          { id: 'parent', status: 'in_progress', parentId: null },
          { id: 'working', status: 'in_progress', parentId: 'parent' },
          { id: 'review', status: 'in_review', parentId: 'parent' },
          { id: 'blocked', status: 'blocked', parentId: null },
        ],
        metrics: { taskCount: 3, averageProgress: 52, overdueCount: 1, blockedCount: 1, staleCount: 0, completionTrend: trend([0, 1, 0, 0, 1, 0, 0]) },
      },
      {
        id: 'project-b',
        name: '移动端',
        items: [{ id: 'done', status: 'done', parentId: null }],
        metrics: { taskCount: 1, averageProgress: 100, overdueCount: 0, blockedCount: 0, staleCount: 1, completionTrend: trend([1, 0, 0, 0, 0, 2, 0]) },
      },
    ]);

    expect(overview.summary).toEqual({ projectCount: 2, taskCount: 4, averageProgress: 64, inProgressCount: 1, inReviewCount: 1, blockedCount: 1, overdueCount: 1, staleCount: 1 });
    expect(overview.statusDistribution).toEqual([
      { status: 'backlog', count: 0 }, { status: 'ready', count: 0 }, { status: 'in_progress', count: 1 },
      { status: 'blocked', count: 1 }, { status: 'in_review', count: 1 }, { status: 'done', count: 1 },
    ]);
    expect(overview.completionTrend.map((entry) => entry.count)).toEqual([1, 1, 0, 0, 1, 2, 0]);
    expect(overview.projects).toEqual([
      expect.objectContaining({ id: 'project-a', name: '核心平台', progress: 52, taskCount: 3, risk: 'critical', overdueCount: 1, blockedCount: 1 }),
      expect.objectContaining({ id: 'project-b', name: '移动端', progress: 100, taskCount: 1, risk: 'watch', staleCount: 1 }),
    ]);
  });

  it('keeps parent tasks out of action counts and returns an empty seven-day shape', () => {
    const overview = aggregateOrganizationOverview([{ id: 'project', name: '空项目', items: [{ id: 'parent', status: 'in_progress', parentId: null }, { id: 'child', status: 'ready', parentId: 'parent' }], metrics: { taskCount: 1, averageProgress: 0, overdueCount: 0, blockedCount: 0, staleCount: 0, completionTrend: trend([0, 0, 0, 0, 0, 0, 0]) } }]);

    expect(overview.summary).toMatchObject({ taskCount: 1, inProgressCount: 0, inReviewCount: 0, blockedCount: 0 });
    expect(overview.statusDistribution.find((entry) => entry.status === 'ready')).toEqual({ status: 'ready', count: 1 });
    expect(overview.completionTrend).toHaveLength(7);
  });
});
