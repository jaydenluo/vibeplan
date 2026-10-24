import { describe, expect, it } from 'vitest';
import { buildTaskContext, validateMaintenancePatch } from './maintenance.js';

describe('AI task maintenance', () => {
  it('summarizes current review issues and latest rejection without reusing an old report', () => {
    const context = buildTaskContext({ id: 't', projectId: 'p', version: 5, status: 'in_progress', acceptanceCycle: 2, planMarkdown: '# Plan\nDecision: preserve API', acceptanceItems: [{ id: 'a', text: 'Works', status: 'failed', comment: 'Mobile broken' }], events: [
      { sequence: '10', action: 'acceptance', payload: { decision: 'rejected', comment: 'Fix mobile' } },
      { sequence: '9', action: 'report', payload: { acceptanceCycle: 1, outcome: 'success' } },
      { sequence: '11', action: 'updated', payload: { executionStage: 'implementation', executionNote: 'Repairing' } },
    ] });
    expect(context.planMarkdown).toContain('Decision');
    expect(context.reviewIssues).toEqual([{ id: 'a', text: 'Works', status: 'failed', comment: 'Mobile broken' }]);
    expect(context.lastRejection?.payload.comment).toBe('Fix mobile');
    expect(context.currentReport).toBeNull();
    expect(context.recentEvents.map((event) => event.sequence)).toEqual(['9', '10', '11']);
    expect(context.nextAction).toContain('report');
  });
  it('bounds events, handles legacy dates and preserves current-cycle evidence', () => {
    const context = buildTaskContext({ id: 't', projectId: 'p', version: 3, status: 'in_review', acceptanceCycle: 1, events: Array.from({ length: 25 }, (_, n) => ({ action: n === 24 ? 'report' : 'updated', createdAt: new Date(n * 1000).toISOString(), payload: { acceptanceCycle: 1 } })) });
    expect(context.recentEvents).toHaveLength(10);
    expect(context.currentReport).not.toBeNull();
    expect(context.nextAction).toContain('reviewer');
  });
  it('keeps failed review feedback after rejection resets the live criteria', () => {
    const context = buildTaskContext({ id: 't', projectId: 'p', version: 8, status: 'in_progress', acceptanceCycle: 2, acceptanceItems: [{ id: 'a', text: 'Mobile layout', status: 'unverified' }], events: [
      { sequence: '1', action: 'acceptance_item_reviewed', payload: { acceptanceItemId: 'a', status: 'failed', comment: 'Old issue' } },
      { sequence: '2', action: 'acceptance', payload: { decision: 'rejected', comment: 'First cycle' } },
      { sequence: '3', action: 'report', payload: { acceptanceCycle: 1 } },
      { sequence: '4', action: 'acceptance_item_reviewed', payload: { acceptanceItemId: 'a', status: 'failed', comment: 'Button clipped', evidence: [{ label: 'preview', url: 'https://example.test' }] } },
      { sequence: '5', action: 'acceptance', payload: { decision: 'rejected', comment: 'Fix layout' } },
    ] });
    expect(context.repairFeedback).toEqual([expect.objectContaining({ acceptanceItemId: 'a', comment: 'Button clipped' })]);
    expect(context.repairPending).toBe(true);
  });
  it('does not call an approved task pending repair when it is later reopened', () => {
    const context = buildTaskContext({ id: 't', projectId: 'p', version: 12, status: 'in_progress', acceptanceCycle: 3, events: [
      { sequence: '1', action: 'acceptance', payload: { decision: 'rejected' } },
      { sequence: '2', action: 'updated', payload: { changes: { acceptanceCycle: { before: 1, after: 2 } } } },
      { sequence: '3', action: 'report', payload: { outcome: 'success', acceptanceCycle: 2 } },
      { sequence: '4', action: 'acceptance', payload: { decision: 'approved' } },
      { sequence: '5', action: 'updated', payload: { changes: { acceptanceCycle: { before: 2, after: 3 } } } },
    ] });
    expect(context.repairPending).toBe(false);
    expect(context.currentReport).toBeNull();
  });
  it('excludes obsolete criterion feedback before an acceptance cycle replacement', () => {
    const context = buildTaskContext({ id: 't', projectId: 'p', version: 8, status: 'in_progress', acceptanceCycle: 3, acceptanceItems: [{ id: 'new', status: 'unverified' }], events: [
      { sequence: '1', action: 'acceptance_item_reviewed', payload: { acceptanceItemId: 'old', status: 'failed', comment: 'Obsolete' } },
      { sequence: '2', action: 'updated', payload: { changes: { acceptanceCycle: { before: 1, after: 2 } } } },
      { sequence: '3', action: 'acceptance_item_reviewed', payload: { acceptanceItemId: 'new', status: 'failed', comment: 'Current issue' } },
      { sequence: '4', action: 'acceptance', payload: { decision: 'rejected' } },
      { sequence: '5', action: 'updated', payload: { changes: { acceptanceCycle: { before: 2, after: 3 } } } },
    ] });
    expect(context.repairFeedback).toEqual([expect.objectContaining({ acceptanceItemId: 'new' })]);
    expect(context.repairPending).toBe(true);
  });
  it('allows scoped planning updates and blocking/resuming with an explanation', () => {
    expect(validateMaintenancePatch({ status: 'blocked', executionStage: 'blocked', executionNote: 'Waiting for API; next: confirm schema', dependsOn: ['60684196-f9bf-4c7e-b6b7-c22eba623de6'] })).toMatchObject({ status: 'blocked' });
    expect(validateMaintenancePatch({ status: 'in_progress', executionNote: 'Dependency resolved', estimate: 2, dueDate: null })).toMatchObject({ estimate: 2, dueDate: null });
  });
  it.each([{ status: 'done' }, { status: 'in_review' }, { status: 'cancelled' }, { acceptanceRecorded: true }, { actualHours: 10 }, { version: 2 }, { unknown: true }, {}, { estimate: 0 }, { dueDate: '2026-02-30' }, { status: 'blocked' }, { acceptanceCriteria: [] }])('rejects unsafe or malformed patch %j', (patch) => {
    expect(() => validateMaintenancePatch(patch)).toThrow();
  });
});
