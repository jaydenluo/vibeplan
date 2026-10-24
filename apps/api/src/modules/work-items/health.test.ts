import { describe, expect, it } from 'vitest';
import { calculatePlannedProgress, calculateProjectProgressSummaries, calculateProgressSummary, calculateRiskFlags } from './health.js';

describe('work item health calculations', () => {
  it('weights parent progress by child estimates', () => {
    expect(calculateProgressSummary({ progress: 10, status: 'in_progress', estimate: 2 }, [
      { progress: 50, status: 'in_progress', estimate: 2 },
      { progress: 100, status: 'done', estimate: 1 },
    ])).toMatchObject({ progress: 67, source: 'children' });
  });

  it('flags overdue, stale and schedule lag risks', () => {
    expect(calculateRiskFlags({
      status: 'in_progress', progress: 20, dueDate: '2026-09-20', estimate: 5,
      startedAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
    }, new Date('2026-09-25T00:00:00.000Z'))).toEqual(['overdue', 'stale', 'behind_schedule']);
  });

  it.each([
    ['backlog', 80, 0], ['ready', 80, 0], ['in_progress', 0, 1],
    ['in_progress', 100, 99], ['in_review', 0, 100], ['done', 0, 100],
  ])('normalizes %s progress %s to %s', (status, progress, expected) => {
    expect(calculateProgressSummary({ status, progress, estimate: null }).progress).toBe(expected);
  });

  it('includes unestimated children and excludes cancelled children', () => {
    expect(calculateProgressSummary({ status: 'in_progress', progress: 10, estimate: null }, [
      { status: 'done', progress: 0, estimate: 1 },
      { status: 'ready', progress: 0, estimate: null },
      { status: 'cancelled', progress: 0, estimate: 100 },
    ])).toMatchObject({ progress: 50, source: 'children' });
  });

  it('recursively accounts for grandchildren regardless of input order', () => {
    const summaries = calculateProjectProgressSummaries([
      { id: 'root', parentId: null, status: 'in_progress', progress: 10, estimate: null },
      { id: 'grandchild-done', parentId: 'child', status: 'done', progress: 0, estimate: 3 },
      { id: 'sibling', parentId: 'root', status: 'ready', progress: 0, estimate: 1 },
      { id: 'child', parentId: 'root', status: 'in_progress', progress: 10, estimate: 2 },
      { id: 'grandchild-ready', parentId: 'child', status: 'ready', progress: 0, estimate: null },
    ]);
    expect(summaries.get('child')).toMatchObject({ progress: 75, source: 'children' });
    expect(summaries.get('root')).toMatchObject({ progress: 50, source: 'children' });
  });

  it('does not recursively loop on corrupt parent cycles', () => {
    const summaries = calculateProjectProgressSummaries([
      { id: 'a', parentId: 'b', status: 'in_progress', progress: 25, estimate: 1 },
      { id: 'b', parentId: 'a', status: 'in_progress', progress: 75, estimate: 1 },
    ]);
    expect([...summaries.values()].every((summary) => Number.isFinite(summary.progress))).toBe(true);
  });

  it('falls back to manual progress when every child is cancelled', () => {
    expect(calculateProgressSummary({ status: 'in_progress', progress: 25, estimate: 1 }, [
      { status: 'cancelled', progress: 100, estimate: 1 },
    ])).toMatchObject({ progress: 25, source: 'manual' });
  });

  it('allows complete child execution while the parent still awaits acceptance', () => {
    const children = [{ status: 'done', progress: 100, estimate: 1 }];
    expect(calculateProgressSummary({ status: 'in_progress', progress: 100, estimate: 1 }, children).progress).toBe(100);
    expect(calculateProgressSummary({ status: 'in_review', progress: 100, estimate: 1 }, children).progress).toBe(100);
  });

  it.each(['backlog', 'ready'])('reflects active descendants when parent status is stale %s', (status) => {
    const summaries = calculateProjectProgressSummaries([
      { id: 'parent', parentId: null, status, progress: 0, estimate: 1 },
      { id: 'child', parentId: 'parent', status: 'ready', progress: 0, estimate: 1 },
      { id: 'grandchild', parentId: 'child', status: 'in_progress', progress: 50, estimate: 1 },
    ]);
    expect(summaries.get('parent')).toMatchObject({ progress: 50, source: 'children' });
    expect(summaries.get('child')).toMatchObject({ progress: 50, source: 'children' });
  });

  it('recalculates a parent after a completed child is reopened', () => {
    const parent = { id: 'parent', parentId: null, status: 'in_progress', progress: 25, estimate: 1 };
    const child = { id: 'child', parentId: 'parent', status: 'done', progress: 100, estimate: 1 };
    expect(calculateProjectProgressSummaries([parent, child]).get('parent')?.progress).toBe(100);
    expect(calculateProjectProgressSummaries([parent, { ...child, status: 'in_progress', progress: 35 }]).get('parent')?.progress).toBe(35);
  });

  it('uses UTC end of day for due soon and overdue boundaries', () => {
    const item = { status: 'ready', progress: 0, dueDate: '2026-10-04', estimate: null };
    expect(calculateRiskFlags(item, new Date('2026-10-03T00:00:00.000Z'))).toEqual(['due_soon']);
    expect(calculateRiskFlags(item, new Date('2026-10-04T23:59:59.999Z'))).toEqual(['due_soon']);
    expect(calculateRiskFlags(item, new Date('2026-10-05T00:00:00.000Z'))).toEqual(['overdue']);
    expect(calculateRiskFlags(item, new Date('2026-10-02T23:59:59.999Z'))).toEqual([]);
  });

  it('reports dependency blocking without requiring dates', () => {
    expect(calculateRiskFlags({ status: 'ready', progress: 0, dueDate: null, estimate: null, blockerIds: ['dependency'] })).toEqual(['blocked']);
  });

  it.each(['done', 'cancelled'])('ignores every risk for %s tasks', (status) => {
    expect(calculateRiskFlags({ status, progress: 0, dueDate: '2020-01-01', estimate: 1, blocked: true, updatedAt: '2020-01-01' })).toEqual([]);
  });

  it('ignores invalid dates instead of producing a NaN planned progress', () => {
    expect(calculatePlannedProgress('invalid', '2026-10-04')).toBeNull();
    expect(calculatePlannedProgress('2026-10-01', 'invalid')).toBeNull();
  });
});
