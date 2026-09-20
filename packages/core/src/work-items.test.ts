import { describe, expect, it } from 'vitest';
import { canTransition, prioritySchema, workItemTypeSchema } from './work-items.js';

describe('work item state machine', () => {
  it('accepts the normal delivery path', () => {
    expect(canTransition({ from: 'backlog', to: 'ready' })).toEqual({ ok: true });
    expect(canTransition({ from: 'ready', to: 'in_progress' })).toEqual({ ok: true });
    expect(canTransition({ from: 'in_progress', to: 'in_review' })).toEqual({ ok: true });
  });

  it('requires acceptance evidence before done', () => {
    expect(canTransition({ from: 'in_review', to: 'done', acceptanceRecorded: false })).toEqual({
      ok: false,
      reason: 'Acceptance evidence is required before marking a work item done.',
    });
    expect(canTransition({ from: 'in_review', to: 'done', acceptanceRecorded: true })).toEqual({
      ok: true,
    });
  });

  it('rejects invalid transitions', () => {
    expect(canTransition({ from: 'backlog', to: 'done', acceptanceRecorded: true })).toEqual({
      ok: false,
      reason: 'Invalid work item state transition: backlog -> done.',
    });
  });
});

describe('work item enums', () => {
  it('accepts supported types and priorities only', () => {
    expect(workItemTypeSchema.parse('feature')).toBe('feature');
    expect(prioritySchema.parse('P1')).toBe('P1');
    expect(() => workItemTypeSchema.parse('unknown')).toThrow();
    expect(() => prioritySchema.parse('P9')).toThrow();
  });
});
