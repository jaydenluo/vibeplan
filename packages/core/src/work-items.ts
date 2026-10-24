import { z } from 'zod';

export const workItemTypeSchema = z.enum([
  'feature',
  'bug',
  'improvement',
  'refactor',
  'documentation',
  'research',
  'chore',
]);

export const workItemStatusSchema = z.enum([
  'backlog',
  'ready',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
]);

export const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3', 'P4']);

export const workItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(240),
  description: z.string().default(''),
  type: workItemTypeSchema,
  status: workItemStatusSchema,
  priority: prioritySchema,
  assigneeId: z.string().min(1).nullable(),
  reporterId: z.string().min(1),
  dueDate: z.string().date().nullable(),
  labels: z.array(z.string().min(1)).default([]),
  component: z.string().min(1).nullable(),
  parentId: z.string().min(1).nullable(),
  dependsOn: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  acceptanceItems: z.array(z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    required: z.boolean(),
    status: z.enum(['unverified', 'passed', 'failed', 'needs_info']),
    comment: z.string(),
    evidence: z.array(z.object({ label: z.string().min(1), url: z.string().url() })),
    reviewedBy: z.string().uuid().nullable(),
    reviewedAt: z.string().datetime().nullable(),
  })).default([]),
  estimate: z.number().int().nonnegative().nullable(),
  actualHours: z.number().nonnegative().nullable().optional(),
  planMarkdown: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  version: z.number().int().positive(),
});

export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkItemStatus = z.infer<typeof workItemStatusSchema>;
export type WorkItemType = z.infer<typeof workItemTypeSchema>;
export type Priority = z.infer<typeof prioritySchema>;

const transitions: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  backlog: ['ready', 'cancelled'],
  ready: ['backlog', 'in_progress', 'cancelled'],
  in_progress: ['ready', 'blocked', 'in_review', 'cancelled'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  in_review: ['in_progress', 'blocked', 'done', 'cancelled'],
  done: ['in_progress'],
  cancelled: ['backlog'],
};

type TransitionInput = {
  from: WorkItemStatus;
  to: WorkItemStatus;
  acceptanceRecorded?: boolean;
};

export function canTransition(input: TransitionInput):
  | { ok: true }
  | { ok: false; reason: string } {
  if (!transitions[input.from].includes(input.to)) {
    return {
      ok: false,
      reason: `Invalid work item state transition: ${input.from} -> ${input.to}.`,
    };
  }

  if (input.to === 'done' && input.acceptanceRecorded !== true) {
    return {
      ok: false,
      reason: 'Acceptance evidence is required before marking a work item done.',
    };
  }

  return { ok: true };
}
