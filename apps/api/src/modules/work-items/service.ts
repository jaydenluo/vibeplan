import { and, asc, eq, inArray, isNull, sql, getTableColumns } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'node:crypto';
import { canTransition, type WorkItemStatus, type WorkItemType } from '@vibeplan/core';
import {
  organizationMemberships,
  projectMilestones,
  projectMemberships,
  projects,
  taskEvents,
  teamMemberships,
  teams,
  workItemMilestones,
  workItemDependencies,
  workItemWorkLogs,
  workItems,
  users,
} from '../../db/schema.js';
import { EntitlementService } from '../billing/entitlements.js';
import { listProjectsForUser } from '../../repositories/projects.js';
import { ProjectEventHub } from './events.js';
import { calculatePlannedProgress, calculateProjectProgressSummaries, calculateRiskFlags, normalizeProgress } from './health.js';
import { calculateProjectMetrics } from './metrics.js';
import { aggregateOrganizationOverview } from './organization-overview.js';
import { appendSyncChange, SyncResetError } from './sync-feed.js';

function hasFailedTestResult(result: string): boolean {
  const normalized = result.replace(/\b0\s+(?:failed|failures|errors)\b/gi, '');
  return /\b(?:failed|failure|error)\b|\bexit(?:\s+code)?\s*[:=]?\s*-?[1-9]\d*\b|测试失败|未通过|报错/i.test(normalized);
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daySpan(start: string, end: string): number {
  return Math.round((new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()) / 86400000) + 1;
}

export class WorkItemAccessError extends Error {
  constructor(message = 'You do not have access to this project.') {
    super(message);
    this.name = 'WorkItemAccessError';
  }
}

export class WorkItemConflictError extends Error {
  constructor(message = 'The work item changed since it was loaded.') {
    super(message);
    this.name = 'WorkItemConflictError';
  }
}

export class WorkItemTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkItemTransitionError';
  }
}

export type AcceptanceItemStatus = 'unverified' | 'passed' | 'failed' | 'needs_info';
export type AcceptanceEvidence = { label: string; url: string };
export type AcceptanceItem = {
  id: string;
  text: string;
  required: boolean;
  status: AcceptanceItemStatus;
  comment: string;
  evidence: AcceptanceEvidence[];
  reviewedBy: string | null;
  reviewedAt: string | null;
};

type CreateInput = {
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  acceptanceCriteria: string[];
  assigneeId?: string | null;
  parentId?: string | null;
  dueDate: string | null;
  estimate: number;
  progress?: number;
  planMarkdown?: string | null;
  dependsOn?: string[];
};

type UpdateInput = Partial<{
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: CreateInput['priority'];
  acceptanceCriteria: string[];
  assigneeId: string | null;
  parentId: string | null;
  dueDate: string | null;
  estimate: number | null;
  progress: number;
  acceptanceRecorded: boolean;
  planMarkdown: string | null;
  dependsOn: string[];
  changeReason: string;
  executionStage: 'analysis' | 'implementation' | 'testing' | 'blocked' | 'ready_for_review';
  executionNote: string;
}>;

export type WorkItemReportInput = {
  summary: string;
  changedFiles: string[];
  tests: Array<{ command: string; result: string; outcome?: 'passed' | 'failed' | 'skipped' | 'not_run'; exitCode?: number }>;
  commit?: string | null;
  evidence?: AcceptanceEvidence[];
  risks?: string[];
  remainingIssues?: string[];
  criterionResults?: Array<{ acceptanceItemId: string; result: string; evidence: AcceptanceEvidence[] }>;
  outcome?: 'success' | 'failed' | 'blocked';
};

export type WorkItemAcceptanceInput = {
  decision: 'approved' | 'rejected';
  comment?: string;
};

export type AcceptanceItemReviewInput = {
  status: AcceptanceItemStatus;
  comment: string;
  evidence: AcceptanceEvidence[];
};

export class WorkItemService {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly eventHub?: ProjectEventHub,
    private readonly now: () => Date = () => new Date(),
    private readonly entitlements = new EntitlementService(database),
  ) {}

  async create(userId: string, projectId: string, input: CreateInput) {
    const result = await this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      return new WorkItemService(tx as unknown as PostgresJsDatabase, undefined, this.now).createLocked(userId, projectId, input);
    });
    this.eventHub?.publish({ projectId, workItemId: result.id, action: 'created', payload: { title: result.title } });
    return result;
  }

  private async createLocked(userId: string, projectId: string, input: CreateInput) {
    await this.requireContributor(userId, projectId, true);
    await this.validateDependencies(projectId, null, input.dependsOn ?? []);
    if (input.status === 'done' || input.status === 'in_review') throw new WorkItemTransitionError('An approval and execution report are required; create a task before submitting it for acceptance.');
    if (input.status === 'in_progress') await this.requireUnblocked(projectId, input.dependsOn ?? []);
    if (input.parentId) {
      const [parent] = await this.database.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.id, input.parentId), eq(workItems.projectId, projectId))).limit(1);
      if (!parent) throw new WorkItemAccessError('Parent work item does not belong to this project.');
    }
    const dueDate = input.dueDate ?? (input.status === 'in_progress' ? this.estimateDueDate(input.estimate) : null);
    const [item] = await this.database.insert(workItems).values({
      projectId,
      title: input.title,
      description: input.description,
      type: input.type,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      reporterId: userId,
      dueDate,
      acceptanceCriteria: input.acceptanceCriteria,
      acceptanceItems: createAcceptanceItems(input.acceptanceCriteria),
      labels: [],
      dependsOn: input.dependsOn ?? [],
      component: null,
      parentId: input.parentId ?? null,
      estimate: input.estimate,
      planMarkdown: input.planMarkdown ?? null,
      progress: normalizeProgress({ status: input.status, progress: input.progress }),
      ...(input.status === 'in_progress' ? { startedAt: this.now() } : {}),
    }).returning();
    if (item.dependsOn.length) {
      await this.database.insert(workItemDependencies).values(item.dependsOn.map((dependsOnId) => ({ workItemId: item.id, dependsOnId }))).onConflictDoNothing();
    }
    await this.recordEvent(projectId, item.id, userId, 'created', { title: item.title, assigneeId: item.assigneeId, progress: item.progress });
    if (item.parentId) await this.rollUpAncestorSchedules(projectId, item.parentId, userId, item.id);
    return normalizeAcceptanceItems(item);
  }

  async list(userId: string, projectId: string, filters: { status?: WorkItemStatus; priority?: CreateInput['priority']; assigneeId?: string } = {}) {
    await this.requireViewer(userId, projectId);
    const items = await this.database.select().from(workItems).where(eq(workItems.projectId, projectId)).orderBy(asc(workItems.createdAt));
    const summaries = calculateProjectProgressSummaries(items, this.now());
    const byId = new Map(items.map((item) => [item.id, item]));
    const dependencyMap = await this.dependencyIdsByWorkItem(projectId);
    const events = await this.events(projectId);
    const latestStages = new Map<string, Record<string, unknown>>();
    const latestReports = new Map<string, Record<string, unknown>>();
    for (const event of events) {
      if (!event.workItemId) continue;
      if (typeof event.payload.executionStage === 'string') latestStages.set(event.workItemId, event.payload);
      if (event.action === 'report') latestReports.set(event.workItemId, event.payload);
    }
    return items.map((item) => {
      const normalized = normalizeAcceptanceItems(item);
      const summary = summaries.get(item.id)!;
      const plannedProgress = calculatePlannedProgress(item.startedAt?.toISOString() ?? null, item.dueDate, this.now());
      const progressSummary = { ...summary, plannedProgress, variance: plannedProgress === null ? null : summary.progress - plannedProgress };
      const blockers = (dependencyMap.get(item.id) ?? []).filter((id) => !['done', 'cancelled'].includes(byId.get(id)?.status ?? 'missing')).map((id) => ({ id, title: byId.get(id)?.title ?? '前置任务已删除或不可用' }));
      const flags = calculateRiskFlags({ status: item.status, blocked: item.status === 'blocked', blockerIds: blockers.map((item) => item.id), progress: summary.progress, dueDate: item.dueDate, estimate: item.estimate, startedAt: item.startedAt?.toISOString() ?? null, updatedAt: item.updatedAt?.toISOString() ?? null }, this.now());
      return { ...normalized, progress: summary.progress, progressSummary, riskFlags: flags, blockers, healthState: flags[0] ?? 'normal', executionStage: latestStages.get(item.id)?.executionStage ?? null, executionNote: latestStages.get(item.id)?.executionNote ?? null, executionReport: latestReports.get(item.id) ?? null };
    }).filter((item) => (!filters.status || item.status === filters.status) && (!filters.priority || item.priority === filters.priority) && (!filters.assigneeId || item.assigneeId === filters.assigneeId));
  }

  async get(userId: string, workItemId: string) {
    const item = await this.getStored(userId, workItemId);
    const derived = (await this.list(userId, item.projectId)).find((candidate) => candidate.id === workItemId);
    if (!derived) throw new WorkItemAccessError('Work item does not exist.');
    const events = await this.history(userId, workItemId);
    return { ...derived, events };
  }

  private async getStored(userId: string, workItemId: string) {
    const [item] = await this.database.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    if (!item) {
      throw new WorkItemAccessError('Work item does not exist.');
    }
    await this.requireViewer(userId, item.projectId);
    return normalizeAcceptanceItems(item);
  }

  async update(userId: string, workItemId: string, expectedVersion: number, input: UpdateInput) {
    return this.withTaskTransaction(workItemId, (service) => service.updateLocked(userId, workItemId, expectedVersion, input), 'updated');
  }

  private async updateLocked(userId: string, workItemId: string, expectedVersion: number, input: UpdateInput, workflow: 'update' | 'report' | 'acceptance' = 'update') {
    const existing = await this.getStored(userId, workItemId);
    await this.requireContributor(userId, existing.projectId, true);
    if (existing.version !== expectedVersion) {
      throw new WorkItemConflictError();
    }
    if ((input.dueDate !== undefined || input.estimate !== undefined) && await this.hasDirectChildren(existing.projectId, existing.id)) {
      throw new WorkItemTransitionError('Parent task schedule is derived from child tasks.');
    }
    if (input.parentId !== undefined) await this.validateParentChange(existing.projectId, existing.id, input.parentId);
    if (input.dependsOn !== undefined) await this.validateDependencies(existing.projectId, existing.id, input.dependsOn);
    if (existing.status === 'in_review' && input.acceptanceCriteria !== undefined && !sameCriteria(existing.acceptanceCriteria, input.acceptanceCriteria)) throw new WorkItemTransitionError('Reject the task with a reason before changing acceptance criteria during review.');
    if (existing.status === 'done' && input.status !== 'in_progress' && input.acceptanceCriteria !== undefined && !sameCriteria(existing.acceptanceCriteria, input.acceptanceCriteria)) {
      throw new WorkItemTransitionError('Reopen the task before changing its acceptance criteria.');
    }
    if (input.status && input.status !== existing.status) {
      if (input.status === 'in_review' && workflow !== 'report') throw new WorkItemTransitionError('A successful execution report is required to enter review.');
      if (existing.status === 'in_review' && !['done', 'cancelled'].includes(input.status) && workflow !== 'acceptance') throw new WorkItemTransitionError('Use the authorized rejection workflow with a reason to return a task for changes.');
      const dependencies = input.dependsOn ?? (await this.dependencyIdsByWorkItem(existing.projectId)).get(existing.id) ?? [];
      if (input.status === 'in_progress') await this.requireUnblocked(existing.projectId, dependencies ?? []);
      const acceptanceRecorded = await this.hasRequiredAcceptanceEvidence(existing);
      if (input.status === 'done' && !acceptanceRecorded && hasStructuredAcceptance(existing)) {
        throw new WorkItemTransitionError('All required acceptance criteria must pass before marking a work item done.');
      }
      if (input.status === 'done' && !await this.hasAcceptance(existing.id, expectedVersion)) {
        throw new WorkItemTransitionError('A recorded approval is required before marking a task done.');
      }
      const transition = canTransition({
        from: existing.status as WorkItemStatus,
        to: input.status,
        acceptanceRecorded,
      });
      if (!transition.ok) {
        throw new WorkItemTransitionError(transition.reason);
      }
    }

    const nextStatus = input.status ?? existing.status;
    const newCycle = (['done', 'in_review'].includes(existing.status) && nextStatus === 'in_progress') || (input.acceptanceCriteria !== undefined && !sameCriteria(existing.acceptanceCriteria, input.acceptanceCriteria));
    const isStarting = nextStatus === 'in_progress' && existing.status !== 'in_progress';
    const requestedDueDate = input.dueDate === undefined ? existing.dueDate : input.dueDate;
    const dueDate = isStarting && !requestedDueDate
      ? this.estimateDueDate(typeof input.estimate === 'number' ? input.estimate : existing.estimate ?? 1)
      : requestedDueDate;
    const patch = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: input.acceptanceCriteria }),
      ...(input.acceptanceCriteria === undefined ? {} : { acceptanceItems: sameCriteria(existing.acceptanceCriteria, input.acceptanceCriteria) ? existing.acceptanceItems : createAcceptanceItems(input.acceptanceCriteria) }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.planMarkdown === undefined ? {} : { planMarkdown: input.planMarkdown }),
      ...(input.dependsOn === undefined ? {} : { dependsOn: input.dependsOn }),
      ...(isStarting && !existing.startedAt ? { startedAt: this.now() } : {}),
      ...(dueDate === existing.dueDate ? {} : { dueDate }),
      ...(input.estimate === undefined ? {} : { estimate: input.estimate }),
      ...(newCycle ? { acceptanceCycle: existing.acceptanceCycle + 1, acceptanceItems: (input.acceptanceCriteria !== undefined ? createAcceptanceItems(input.acceptanceCriteria) : existing.acceptanceItems.map((item) => ({ ...item, status: 'unverified' as const, comment: '', evidence: [], reviewedBy: null, reviewedAt: null }))) } : {}),
      progress: normalizeProgress({ status: nextStatus, progress: input.progress ?? existing.progress }),
      version: expectedVersion + 1,
      updatedAt: this.now(),
    };
    const [updated] = await this.database
      .update(workItems)
      .set(patch)
      .where(and(eq(workItems.id, workItemId), eq(workItems.version, expectedVersion)))
      .returning();
    if (!updated) {
      throw new WorkItemConflictError();
    }
    if (input.dependsOn !== undefined) {
      await this.database.delete(workItemDependencies).where(eq(workItemDependencies.workItemId, updated.id));
      if (updated.dependsOn.length) {
        await this.database.insert(workItemDependencies).values(updated.dependsOn.map((dependsOnId) => ({ workItemId: updated.id, dependsOnId }))).onConflictDoNothing();
      }
    }
    const assignmentChanged = input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId;
    const eventPayload = {
      ...input,
      changes: Object.fromEntries(Object.keys(patch).filter((key) => !['version', 'updatedAt'].includes(key) && JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(updated[key as keyof typeof updated])).map((key) => [key, { before: existing[key as keyof typeof existing], after: updated[key as keyof typeof updated] }])),
      resultProgress: updated.progress,
      ...(assignmentChanged ? {
        previousAssigneeId: existing.assigneeId,
        newAssigneeId: updated.assigneeId,
        handoffProgress: existing.progress,
      } : {}),
    };
    await this.recordEvent(updated.projectId, updated.id, userId, 'updated', eventPayload);
    if (updated.parentId && (updated.dueDate !== existing.dueDate || updated.estimate !== existing.estimate)) {
      await this.rollUpAncestorSchedules(updated.projectId, updated.parentId, userId, updated.id);
    }
    if (existing.parentId && existing.parentId !== updated.parentId) {
      await this.rollUpAncestorSchedules(updated.projectId, existing.parentId, userId, updated.id);
    }
    return normalizeAcceptanceItems(updated);
  }

  async updateAcceptanceItem(userId: string, workItemId: string, expectedVersion: number, acceptanceItemId: string, input: AcceptanceItemReviewInput) {
    return this.withTaskTransaction(workItemId, (service) => service.reviewLocked(userId, workItemId, expectedVersion, acceptanceItemId, input), 'acceptance_item_reviewed');
  }

  private async reviewLocked(userId: string, workItemId: string, expectedVersion: number, acceptanceItemId: string, input: AcceptanceItemReviewInput) {
    const existing = await this.getStored(userId, workItemId);
    await this.requireReviewer(userId, existing.projectId, true);
    if (existing.version !== expectedVersion) throw new WorkItemConflictError();
    if (existing.status === 'done') throw new WorkItemTransitionError('Reopen the task before changing its acceptance result.');
    const index = existing.acceptanceItems.findIndex((item) => item.id === acceptanceItemId);
    if (index < 0) throw new WorkItemAccessError('Acceptance criterion does not exist.');
    const reviewedAt = this.now();
    const acceptanceItems = existing.acceptanceItems.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      status: input.status,
      comment: input.comment,
      evidence: input.evidence,
      reviewedBy: userId,
      reviewedAt: reviewedAt.toISOString(),
    } : item);
    const [updated] = await this.database.update(workItems).set({
      acceptanceItems,
      version: expectedVersion + 1,
      updatedAt: reviewedAt,
    }).where(and(eq(workItems.id, workItemId), eq(workItems.version, expectedVersion))).returning();
    if (!updated) throw new WorkItemConflictError();
    const reviewed = acceptanceItems[index];
    await this.recordEvent(updated.projectId, updated.id, userId, 'acceptance_item_reviewed', {
      acceptanceItemId,
      status: reviewed.status,
      comment: reviewed.comment,
      evidence: reviewed.evidence,
      reviewedBy: reviewed.reviewedBy,
      reviewedAt: reviewed.reviewedAt,
    });
    return normalizeAcceptanceItems(updated);
  }

  async addWorkLog(userId: string, workItemId: string, input: { hours: number; content: string; workDate: string }) {
    const result = await this.database.transaction(async (tx) => {
      const [item] = await tx.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, workItemId));
      if (item) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${item.projectId}))`);
      await tx.execute(sql`select id from work_items where id = ${workItemId} for update`);
      const service = new WorkItemService(tx as unknown as PostgresJsDatabase, undefined, this.now);
      return service.addWorkLogLocked(userId, workItemId, input);
    });
    this.eventHub?.publish({ projectId: result.projectId, workItemId, action: 'work_log', payload: input });
    return result.log;
  }

  private async addWorkLogLocked(userId: string, workItemId: string, input: { hours: number; content: string; workDate: string }) {
    const item = await this.getStored(userId, workItemId);
    await this.requireContributor(userId, item.projectId, true);
    const [log] = await this.database.insert(workItemWorkLogs).values({ workItemId, userId, hours: String(input.hours), content: input.content, workDate: input.workDate }).returning();
    const total = await this.database.select({ hours: workItemWorkLogs.hours }).from(workItemWorkLogs).where(and(eq(workItemWorkLogs.workItemId, workItemId), isNull(workItemWorkLogs.revokedAt)));
    await this.database.update(workItems).set({ actualHours: total.reduce((sum, row) => sum + Number(row.hours), 0).toFixed(2), updatedAt: this.now(), version: item.version + 1 }).where(and(eq(workItems.id, workItemId), eq(workItems.version, item.version)));
    await this.recordEvent(item.projectId, item.id, userId, 'work_log', { ...input, logId: log.id });
    return { projectId: item.projectId, log: { ...log, hours: Number(log.hours) } };
  }

  async workLogs(userId: string, workItemId: string) {
    const item = await this.getStored(userId, workItemId);
    return (await this.database.select().from(workItemWorkLogs).where(eq(workItemWorkLogs.workItemId, item.id)).orderBy(asc(workItemWorkLogs.workDate))).map((log) => ({ ...log, hours: Number(log.hours) }));
  }

  async correctWorkLog(userId: string, workItemId: string, logId: string, version: number, patch: { hours?: number; content?: string; workDate?: string; revoked?: boolean; reason: string }) {
    if (!patch.reason.trim()) throw new WorkItemTransitionError('A correction reason is required.');
    const result = await this.withTaskTransaction(workItemId, async (service) => {
      const item = await service.getStored(userId, workItemId);
      await service.requireContributor(userId, item.projectId, true);
      const [before] = await service.database.select().from(workItemWorkLogs).where(and(eq(workItemWorkLogs.id, logId), eq(workItemWorkLogs.workItemId, workItemId)));
      if (!before || before.userId !== userId) throw new WorkItemAccessError('Only the work log author can correct or withdraw it.');
      if (before.version !== version || before.revokedAt) throw new WorkItemConflictError('The work log changed or was withdrawn.');
      if (patch.hours !== undefined && (!Number.isFinite(patch.hours) || patch.hours <= 0 || patch.hours > 999999)) throw new WorkItemTransitionError('Invalid actual hours.');
      const [log] = await service.database.update(workItemWorkLogs).set({
        ...(patch.hours === undefined ? {} : { hours: String(patch.hours) }),
        ...(patch.content === undefined ? {} : { content: patch.content }),
        ...(patch.workDate === undefined ? {} : { workDate: patch.workDate }),
        ...(patch.revoked ? { revokedAt: this.now() } : {}),
        version: version + 1, updatedAt: this.now(),
      }).where(and(eq(workItemWorkLogs.id, logId), eq(workItemWorkLogs.version, version))).returning();
      const logs = await service.database.select().from(workItemWorkLogs).where(and(eq(workItemWorkLogs.workItemId, workItemId), isNull(workItemWorkLogs.revokedAt)));
      await service.database.update(workItems).set({ actualHours: logs.reduce((n, row) => n + Number(row.hours), 0).toFixed(2), version: item.version + 1, updatedAt: this.now() }).where(eq(workItems.id, workItemId));
      await service.recordEvent(item.projectId, workItemId, userId, 'work_log_corrected', { reason: patch.reason, before, after: log });
      return { id: item.id, projectId: item.projectId, status: item.status, log: { ...log, hours: Number(log.hours) } };
    }, 'work_log_corrected');
    return result.log;
  }

  async contributors(userId: string, projectId: string, range: { from?: string; to?: string } = {}) {
    await this.requireViewer(userId, projectId);
    const logs = await this.database.select({ log: workItemWorkLogs }).from(workItemWorkLogs).innerJoin(workItems, eq(workItems.id, workItemWorkLogs.workItemId)).where(and(eq(workItems.projectId, projectId), isNull(workItemWorkLogs.revokedAt)));
    const members = new Map<string, { userId: string; displayName: string; hours: number; logCount: number; reportCount: number; testCount: number; reviewCount: number }>();
    const member = (id: string) => {
      if (!members.has(id)) members.set(id, { userId: id, displayName: '历史成员', hours: 0, logCount: 0, reportCount: 0, testCount: 0, reviewCount: 0 });
      return members.get(id)!;
    };
    const inside = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to);
    for (const { log } of logs) if (inside(log.workDate)) { const row = member(log.userId); row.hours += Number(log.hours); row.logCount++; }
    for (const event of await this.events(projectId)) if (inside(event.createdAt.toISOString().slice(0, 10))) {
      if (event.action === 'report') {
        member(event.actorId).reportCount++;
        if (Array.isArray(event.payload.tests)) member(event.actorId).testCount += event.payload.tests.filter((test: { outcome?: string; exitCode?: number }) => test.outcome === 'passed' || test.outcome === 'failed' || test.exitCode !== undefined).length;
      }
      if (['acceptance', 'acceptance_item_reviewed'].includes(event.action)) member(event.actorId).reviewCount++;
    }
    if (members.size) for (const person of await this.database.select().from(users).where(inArray(users.id, [...members.keys()]))) member(person.id).displayName = person.displayName || '历史成员';
    return { members: [...members.values()].map((row) => ({ ...row, hours: Math.round(row.hours * 100) / 100 })).sort((a, b) => b.hours - a.hours || a.userId.localeCompare(b.userId)), ...range };
  }

  async myWork(userId: string, organizationId: string) {
    const [membership] = await this.database.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId)));
    if (!membership) throw new WorkItemAccessError();
    type Entry = { id: string; projectId: string; projectName: string; title: string; status: string; priority: string; dueDate: string | null; reason: string };
    const queues: Record<'inProgress' | 'ready' | 'blocked' | 'inReview', Entry[]> = { inProgress: [], ready: [], blocked: [], inReview: [] };
    const candidates = await this.database.select({ id: projects.id, name: projects.name }).from(projects).innerJoin(teams, eq(teams.id, projects.teamId)).where(eq(teams.organizationId, organizationId));
    for (const project of candidates) {
      let items: Awaited<ReturnType<WorkItemService['list']>>;
      try { items = await this.list(userId, project.id); } catch (error) { if (error instanceof WorkItemAccessError) continue; throw error; }
      let reviewer = false;
      try { await this.requireReviewer(userId, project.id); reviewer = true; } catch (error) { if (!(error instanceof WorkItemAccessError)) throw error; }
      let contributor = false;
      try { await this.requireContributor(userId, project.id); contributor = true; } catch (error) { if (!(error instanceof WorkItemAccessError)) throw error; }
      for (const item of items) {
        const entry: Entry = { id: item.id, projectId: project.id, projectName: project.name, title: item.title, status: item.status, priority: item.priority, dueDate: item.dueDate, reason: '' };
        if (item.status === 'in_review' && reviewer) queues.inReview.push({ ...entry, reason: '待你审核本轮交付与验收证据' });
        if (!contributor || item.assigneeId !== userId || ['done', 'cancelled', 'in_review'].includes(item.status)) continue;
        if (item.status === 'blocked' || item.blockers.length) queues.blocked.push({ ...entry, reason: item.blockers.length ? `前置任务未完成：${item.blockers.map((b) => b.title).join('、')}` : '任务已标记为受阻' });
        else if (item.status === 'in_progress') queues.inProgress.push({ ...entry, reason: '优先继续已开始的任务' });
        else if (['backlog', 'ready'].includes(item.status)) queues.ready.push({ ...entry, reason: '前置任务已完成，可开始；按优先级和日期推荐' });
      }
    }
    const sort = (a: Entry, b: Entry) => a.priority.localeCompare(b.priority) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id);
    for (const queue of Object.values(queues)) queue.sort(sort);
    return { ...queues, next: queues.inProgress[0] ?? queues.ready[0] ?? null };
  }

  async organizationOverview(userId: string, organizationId: string) {
    const [membership] = await this.database.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId)));
    if (!membership) throw new WorkItemAccessError();
    const visibleProjects = await listProjectsForUser(this.database, userId, organizationId);
    const projectData = await Promise.all(visibleProjects.map(async (project) => {
      const items = await this.list(userId, project.id);
      const events = await this.events(project.id);
      return {
        id: project.id,
        name: project.name,
        items,
        metrics: calculateProjectMetrics(items, events.flatMap((event) => event.workItemId ? [{ ...event, workItemId: event.workItemId }] : []), this.now()),
      };
    }));
    return aggregateOrganizationOverview(projectData);
  }

  async assertMutationAccess(userId: string, projectId: string, reviewer = false) {
    return reviewer ? this.requireReviewer(userId, projectId, true) : this.requireContributor(userId, projectId, true);
  }

  async setDependencies(userId: string, workItemId: string, dependencyIds: string[]) {
    const item = await this.getStored(userId, workItemId);
    return this.update(userId, workItemId, item.version, { dependsOn: [...new Set(dependencyIds)] });
  }

  private async validateDependencies(projectId: string, workItemId: string | null, dependencyIds: string[]) {
    if (workItemId && dependencyIds.includes(workItemId)) throw new WorkItemTransitionError('A task cannot depend on itself.');
    const candidates = await this.database.select({ id: workItems.id }).from(workItems).where(eq(workItems.projectId, projectId));
    const graph = await this.dependencyIdsByWorkItem(projectId);
    for (const candidate of candidates) if (!graph.has(candidate.id)) graph.set(candidate.id, []);
    if (dependencyIds.some((id) => !graph.has(id))) throw new WorkItemAccessError('Dependencies must belong to the same project.');
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
      if (from === target) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (graph.get(from) ?? []).some((next) => reaches(next, target, seen));
    };
    if (workItemId && dependencyIds.some((dependencyId) => reaches(dependencyId, workItemId))) throw new WorkItemTransitionError('Dependency cycle detected.');
  }

  private async requireUnblocked(projectId: string, dependencyIds: string[]) {
    if (!dependencyIds.length) return;
    const dependencies = await this.database.select({ id: workItems.id, title: workItems.title, status: workItems.status }).from(workItems).where(and(eq(workItems.projectId, projectId), inArray(workItems.id, dependencyIds)));
    const incomplete = dependencies.filter((item) => !['done', 'cancelled'].includes(item.status));
    const missing = dependencyIds.filter((id) => !dependencies.some((item) => item.id === id));
    if (incomplete.length || missing.length) throw new WorkItemTransitionError(`Task is blocked by: ${[...incomplete.map((item) => item.title), ...missing.map(() => '前置任务已删除或不可用')].join(', ')}`);
  }

  private async hasDirectChildren(projectId: string, workItemId: string): Promise<boolean> {
    const [child] = await this.database.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.projectId, projectId), eq(workItems.parentId, workItemId))).limit(1);
    return Boolean(child);
  }

  private async validateParentChange(projectId: string, workItemId: string, parentId: string | null) {
    if (!parentId) return;
    if (parentId === workItemId) throw new WorkItemTransitionError('A task cannot be its own parent.');
    const [parent] = await this.database.select({ id: workItems.id, parentId: workItems.parentId })
      .from(workItems)
      .where(and(eq(workItems.id, parentId), eq(workItems.projectId, projectId)))
      .limit(1);
    if (!parent) throw new WorkItemAccessError('Parent work item does not belong to this project.');
    const visited = new Set<string>([workItemId]);
    let current: string | null = parent.id;
    while (current) {
      if (visited.has(current)) throw new WorkItemTransitionError('Parent task cycle detected.');
      visited.add(current);
      const [ancestor] = await this.database.select({ parentId: workItems.parentId }).from(workItems)
        .where(and(eq(workItems.id, current), eq(workItems.projectId, projectId))).limit(1);
      current = ancestor?.parentId ?? null;
    }
  }

  async listDependencies(userId: string, workItemId: string) {
    const item = await this.getStored(userId, workItemId);
    const rows = await this.database.select({ dependsOnId: workItemDependencies.dependsOnId })
      .from(workItemDependencies).where(eq(workItemDependencies.workItemId, workItemId));
    const dependencyIds = rows.map((row) => row.dependsOnId);
    if (!dependencyIds.length) return [];
    return this.database.select().from(workItems).where(and(eq(workItems.projectId, item.projectId), inArray(workItems.id, dependencyIds)));
  }

  private async dependencyIdsByWorkItem(projectId: string): Promise<Map<string, string[]>> {
    const rows = await this.database.select({
      workItemId: workItemDependencies.workItemId,
      dependsOnId: workItemDependencies.dependsOnId,
    }).from(workItemDependencies)
      .innerJoin(workItems, eq(workItems.id, workItemDependencies.workItemId))
      .where(eq(workItems.projectId, projectId));
    const dependencyIds = [...new Set(rows.map((row) => row.dependsOnId))];
    const validDependencies = dependencyIds.length
      ? new Set((await this.database.select({ id: workItems.id }).from(workItems).where(and(eq(workItems.projectId, projectId), inArray(workItems.id, dependencyIds)))).map((row) => row.id))
      : new Set<string>();
    const result = new Map<string, string[]>();
    for (const row of rows) if (validDependencies.has(row.dependsOnId)) result.set(row.workItemId, [...(result.get(row.workItemId) ?? []), row.dependsOnId]);
    return result;
  }

  async createMilestone(userId: string, projectId: string, input: { name: string; description: string; targetDate: string | null }) {
    await this.requireContributor(userId, projectId, true);
    return this.database.insert(projectMilestones).values({ projectId, name: input.name, description: input.description, targetDate: input.targetDate }).returning();
  }

  async listMilestones(userId: string, projectId: string) {
    await this.requireViewer(userId, projectId);
    return this.database.select().from(projectMilestones).where(eq(projectMilestones.projectId, projectId)).orderBy(asc(projectMilestones.targetDate));
  }

  async assignMilestone(userId: string, workItemId: string, milestoneId: string) {
    const item = await this.getStored(userId, workItemId);
    await this.requireContributor(userId, item.projectId, true);
    const [milestone] = await this.database.select().from(projectMilestones).where(and(eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, item.projectId))).limit(1);
    if (!milestone) throw new WorkItemAccessError('Milestone does not belong to this project.');
    await this.database.insert(workItemMilestones).values({ workItemId, milestoneId }).onConflictDoNothing();
    return milestone;
  }

  async health(userId: string, projectId: string) {
    const items = await this.list(userId, projectId);
    const risks = items.flatMap((item) => item.riskFlags.map((flag) => ({ itemId: item.id, flag })));
    const milestones = await this.listMilestones(userId, projectId);
    const events = await this.events(projectId);
    const metrics = calculateProjectMetrics(items, events.flatMap((event) => event.workItemId ? [{ ...event, workItemId: event.workItemId }] : []), this.now());
    const names = await this.database.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [...new Set(metrics.memberLoads.map((load) => load.assigneeId).filter((id): id is string => Boolean(id)))]));
    const namesById = new Map(names.map((user) => [user.id, user.name]));
    return { ...metrics, contributors: (await this.contributors(userId, projectId)).members, memberLoads: metrics.memberLoads.map((load) => ({ ...load, displayName: load.assigneeId ? namesById.get(load.assigneeId) || '历史成员' : '未分配' })), risks, milestones };
  }

  async remove(userId: string, workItemId: string, expectedVersion: number) {
    return this.withTaskTransaction(workItemId, (service) => service.removeLocked(userId, workItemId, expectedVersion), 'deleted');
  }

  private async removeLocked(userId: string, workItemId: string, expectedVersion: number) {
    const existing = await this.getStored(userId, workItemId);
    await this.requireContributor(userId, existing.projectId, true);
    if (existing.version !== expectedVersion) throw new WorkItemConflictError();

    const projectItems = await this.database
      .select({ id: workItems.id, parentId: workItems.parentId })
      .from(workItems)
      .where(eq(workItems.projectId, existing.projectId));
    const childrenByParent = new Map<string, string[]>();
    for (const item of projectItems) {
      if (!item.parentId) continue;
      childrenByParent.set(item.parentId, [...(childrenByParent.get(item.parentId) ?? []), item.id]);
    }
    const deletedIds: string[] = [];
    const pending = [existing.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      deletedIds.push(id);
      pending.push(...(childrenByParent.get(id) ?? []));
    }

    const ancestors = new Set<string>();
    let parentId = existing.parentId;
    while (parentId && !ancestors.has(parentId)) { ancestors.add(parentId); parentId = projectItems.find((item) => item.id === parentId)?.parentId ?? null; }
    await this.database.delete(workItems).where(inArray(workItems.id, deletedIds));
    if (existing.parentId) await this.rollUpAncestorSchedules(existing.projectId, existing.parentId, userId, existing.id);
    for (const id of deletedIds) await appendSyncChange(this.database, existing.projectId, id, 'delete');
    for (const id of ancestors) await appendSyncChange(this.database, existing.projectId, id, 'upsert');
    await this.invalidateRelated(existing.projectId, [...deletedIds, ...ancestors]);
    this.eventHub?.publish({ projectId: existing.projectId, workItemId: existing.id, action: 'deleted', payload: { deletedIds } });
    return { id: existing.id, projectId: existing.projectId, status: 'deleted' as const, deletedIds };
  }

  async report(userId: string, workItemId: string, expectedVersion: number, input: WorkItemReportInput) {
    return this.withTaskTransaction(workItemId, (service) => service.reportLocked(userId, workItemId, expectedVersion, input), 'report');
  }

  private async reportLocked(userId: string, workItemId: string, expectedVersion: number, input: WorkItemReportInput) {
    const existing = await this.getStored(userId, workItemId);
    await this.requireContributor(userId, existing.projectId, true);
    if (existing.version !== expectedVersion) throw new WorkItemConflictError();
    const outcome = input.outcome ?? 'success';
    if (!['in_progress', 'blocked'].includes(existing.status)) throw new WorkItemTransitionError('Only an active task can submit an execution report.');
    if (outcome === 'success' && input.tests.some((test) => test.outcome === 'failed' || (test.exitCode !== undefined && test.exitCode !== 0) || hasFailedTestResult(test.result))) throw new WorkItemTransitionError('A report with failed tests cannot claim successful delivery.');
    if (input.criterionResults?.some((result) => !existing.acceptanceItems.some((item) => item.id === result.acceptanceItemId))) throw new WorkItemTransitionError('Execution evidence references an unknown acceptance criterion.');
    const nextStatus = outcome === 'success' ? 'in_review' : outcome === 'blocked' ? 'blocked' : existing.status;
    if (nextStatus !== existing.status) {
      const transition = canTransition({ from: existing.status as WorkItemStatus, to: nextStatus as WorkItemStatus });
      if (!transition.ok) throw new WorkItemTransitionError(transition.reason);
    }
    const warnings = input.tests.length || input.evidence?.length ? [] : ['没有测试结果或链接证据，请在验收前补充。'];
    await this.recordEvent(existing.projectId, existing.id, userId, 'report', { ...input, outcome, warnings, taskVersion: expectedVersion, acceptanceCycle: existing.acceptanceCycle });
    return this.updateLocked(userId, workItemId, expectedVersion, { status: nextStatus as WorkItemStatus }, 'report');
  }

  async accept(userId: string, workItemId: string, expectedVersion: number, input: WorkItemAcceptanceInput) {
    return this.withTaskTransaction(workItemId, (service) => service.acceptLocked(userId, workItemId, expectedVersion, input), 'acceptance');
  }

  private async acceptLocked(userId: string, workItemId: string, expectedVersion: number, input: WorkItemAcceptanceInput) {
    const existing = await this.getStored(userId, workItemId);
    await this.requireReviewer(userId, existing.projectId, true);
    if (existing.version !== expectedVersion) throw new WorkItemConflictError();
    if (input.decision === 'rejected' && !input.comment?.trim()) throw new WorkItemTransitionError('A rejection reason is required.');
    const nextStatus = input.decision === 'approved' ? 'done' : 'in_progress';
    const acceptanceRecorded = input.decision === 'approved' && (!hasStructuredAcceptance(existing) || await this.hasRequiredAcceptanceEvidence(existing));
    if (input.decision === 'approved' && !acceptanceRecorded && hasStructuredAcceptance(existing)) {
      throw new WorkItemTransitionError('All required acceptance criteria must pass before accepting a work item.');
    }
    const transition = canTransition({ from: existing.status as WorkItemStatus, to: nextStatus, acceptanceRecorded });
    if (!transition.ok) throw new WorkItemTransitionError(transition.reason);
    if (input.decision === 'approved') {
      const delivery = await this.database.select().from(taskEvents).where(and(eq(taskEvents.workItemId, existing.id), inArray(taskEvents.action, ['report', 'acceptance']))).orderBy(asc(taskEvents.sequence), asc(taskEvents.createdAt));
      const latest = delivery.at(-1);
      if (latest?.action !== 'report' || (latest.payload.outcome && latest.payload.outcome !== 'success') || (latest.payload.acceptanceCycle ?? 1) !== existing.acceptanceCycle) throw new WorkItemTransitionError('A current successful execution report is required before approval.');
    }
    await this.recordEvent(existing.projectId, existing.id, userId, 'acceptance', { ...input, taskVersion: expectedVersion });
    return this.updateLocked(userId, workItemId, expectedVersion, { status: nextStatus, acceptanceRecorded }, 'acceptance');
  }

  private async withTaskTransaction<T extends { projectId: string; id: string; status: string }>(workItemId: string, action: (service: WorkItemService) => Promise<T>, event: string): Promise<T> {
    const result = await this.database.transaction(async (tx) => {
      const [item] = await tx.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, workItemId));
      if (item) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${item.projectId}))`);
      await tx.execute(sql`select id from work_items where id = ${workItemId} for update`);
      return action(new WorkItemService(tx as unknown as PostgresJsDatabase, undefined, this.now));
    });
    this.eventHub?.publish({ projectId: result.projectId, workItemId: result.id, action: event, payload: { status: result.status } });
    return result;
  }

  async history(userId: string, workItemId: string) {
    const item = await this.getStored(userId, workItemId);
    return this.database.select({ ...getTableColumns(taskEvents), actorName: users.displayName }).from(taskEvents).leftJoin(users, eq(users.id, taskEvents.actorId)).where(eq(taskEvents.workItemId, item.id)).orderBy(asc(taskEvents.sequence), asc(taskEvents.createdAt));
  }

  async permissions(userId: string, workItemId: string) {
    const item = await this.getStored(userId, workItemId);
    const allowed = async (check: () => Promise<void>) => {
      try { await check(); return true; } catch (error) { if (error instanceof WorkItemAccessError) return false; throw error; }
    };
    return { canContribute: await allowed(() => this.requireContributor(userId, item.projectId)), canReview: await allowed(() => this.requireReviewer(userId, item.projectId)) };
  }

  async events(projectId: string) {
    return this.database.select().from(taskEvents).where(eq(taskEvents.projectId, projectId)).orderBy(asc(taskEvents.sequence), asc(taskEvents.createdAt));
  }

  async assertViewer(userId: string, projectId: string): Promise<void> {
    await this.requireViewer(userId, projectId);
  }

  private async recordEvent(projectId: string, workItemId: string, actorId: string, action: string, payload: Record<string, unknown>) {
    const sequence = await appendSyncChange(this.database, projectId, workItemId, 'upsert');
    await this.database.insert(taskEvents).values({ projectId, workItemId, actorId, action, payload, sequence, createdAt: this.now() });
    await this.invalidateRelated(projectId, [workItemId]);
    // Broadcast only from the committed outer operation. Publishing here can
    // notify SSE clients about a mutation that later rolls back.
  }

  /** Keeps each ancestor's scheduled range equal to the ranges of its direct children. */
  private async rollUpAncestorSchedules(projectId: string, parentId: string, actorId: string, sourceWorkItemId: string) {
    const items = await this.database.select().from(workItems).where(eq(workItems.projectId, projectId));
    const byId = new Map(items.map((item) => [item.id, item]));
    const childrenByParent = new Map<string, string[]>();
    for (const item of items) if (item.parentId) childrenByParent.set(item.parentId, [...(childrenByParent.get(item.parentId) ?? []), item.id]);

    let currentId: string | null = parentId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = byId.get(currentId);
      if (!parent) break;
      const scheduledChildren = (childrenByParent.get(currentId) ?? []).map((id) => byId.get(id)).filter((child): child is NonNullable<typeof child> => Boolean(child?.dueDate && child.estimate !== null));
      const range = scheduledChildren.length ? scheduledChildren.reduce((result, child) => {
        const estimate = Math.max(1, child.estimate ?? 1);
        const start = shiftDate(child.dueDate!, -(estimate - 1));
        return { start: start < result.start ? start : result.start, end: child.dueDate! > result.end ? child.dueDate! : result.end };
      }, { start: '9999-12-31', end: '0000-01-01' }) : null;
      // An unscheduled child has no reliable range to roll up. Preserve a
      // manually planned parent instead of clearing it and creating a stale
      // version conflict for unrelated parent mutations.
      if (!range) {
        currentId = parent.parentId;
        continue;
      }
      const nextDueDate = range?.end ?? null;
      const nextEstimate = range ? daySpan(range.start, range.end) : null;
      if (parent.dueDate !== nextDueDate || parent.estimate !== nextEstimate) {
        const [updated] = await this.database.update(workItems).set({ dueDate: nextDueDate, estimate: nextEstimate, version: parent.version + 1, updatedAt: this.now() }).where(eq(workItems.id, parent.id)).returning();
        if (updated) {
          byId.set(updated.id, updated);
          await this.recordEvent(projectId, updated.id, actorId, 'schedule_rollup', {
            sourceWorkItemId,
            changes: {
              dueDate: { before: parent.dueDate, after: updated.dueDate },
              estimate: { before: parent.estimate, after: updated.estimate },
            },
          });
        }
      }
      currentId = parent.parentId;
    }
  }

  private async invalidateRelated(projectId: string, changedIds: string[]) {
    const items = await this.database.select({ id: workItems.id, parentId: workItems.parentId }).from(workItems).where(eq(workItems.projectId, projectId));
    const dependencyMap = await this.dependencyIdsByWorkItem(projectId);
    const changed = new Set(changedIds);
    // Parent progress and dependent blockers are derived, not separate task edits.
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const item of items) {
        if (changed.has(item.id) && item.parentId && !changed.has(item.parentId)) { changed.add(item.parentId); expanded = true; }
        if (!changed.has(item.id) && (dependencyMap.get(item.id) ?? []).some((id) => changed.has(id))) { changed.add(item.id); expanded = true; }
      }
    }
    for (const item of items) if (changed.has(item.id) && !changedIds.includes(item.id)) await appendSyncChange(this.database, projectId, item.id, 'upsert');
  }

  async syncFeed(userId: string, projectId: string, cursor?: string, limit = 200) {
    return this.database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const service = new WorkItemService(tx as unknown as PostgresJsDatabase, undefined, this.now);
      await service.requireViewer(userId, projectId);
      const [head] = await tx.execute(sql`select sequence::text, minimum_cursor::text from project_sync_heads where project_id=${projectId}`);
      const sequence = String(head?.sequence ?? '0');
      const minimum = String(head?.minimum_cursor ?? '0');
      if (cursor === undefined) return { mode: 'snapshot' as const, cursor: sequence, items: await service.list(userId, projectId), deletedIds: [], changes: [], hasMore: false };
      if (!/^\d{1,19}$/.test(cursor) || BigInt(cursor) > BigInt(sequence) || BigInt(cursor) < BigInt(minimum)) throw new SyncResetError();
      const rows = await tx.execute(sql`select sequence::text, work_item_id, action from project_sync_changes where project_id=${projectId} and sequence>${cursor}::bigint order by sequence limit ${Math.max(1, Math.min(1000, limit)) + 1}`);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const byId = new Map((page.some((row) => row.action === 'upsert') ? await service.list(userId, projectId) : []).map((item) => [item.id, item]));
      const changes = page.map((row) => {
        const id = String(row.work_item_id);
        const item = byId.get(id);
        return { sequence: String(row.sequence), id, action: row.action === 'delete' || !item ? 'delete' as const : 'upsert' as const, ...(row.action === 'upsert' && item ? { item } : {}) };
      });
      return { mode: 'delta' as const, cursor: page.length ? String(page.at(-1)!.sequence) : sequence, changes, items: changes.flatMap((change) => change.item ? [change.item] : []), deletedIds: changes.filter((change) => change.action === 'delete').map((change) => change.id), hasMore };
    });
  }

  private estimateDueDate(estimate: number): string {
    const date = new Date(this.now());
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + Math.max(1, estimate) - 1);
    return date.toISOString().slice(0, 10);
  }

  private async hasAcceptance(workItemId: string, expectedVersion?: number): Promise<boolean> {
    const records = await this.database.select({ payload: taskEvents.payload }).from(taskEvents)
      .where(and(eq(taskEvents.workItemId, workItemId), eq(taskEvents.action, 'acceptance')))
      .orderBy(asc(taskEvents.sequence), asc(taskEvents.createdAt));
    const latest = records.at(-1)?.payload;
    return expectedVersion === undefined ? latest?.decision === 'approved' : records.some((record) => record.payload.decision === 'approved' && record.payload.taskVersion === expectedVersion);
  }

  private async hasRequiredAcceptanceEvidence(item: { id: string; acceptanceItems: AcceptanceItem[] }): Promise<boolean> {
    if (hasStructuredAcceptance(item)) {
      return item.acceptanceItems.filter((acceptanceItem) => acceptanceItem.required).every((acceptanceItem) => acceptanceItem.status === 'passed');
    }
    return this.hasAcceptance(item.id);
  }

  private async requireViewer(userId: string, projectId: string): Promise<void> {
    const [project] = await this.database
      .select({ id: projects.id, organizationId: teams.organizationId })
      .from(projects)
      .innerJoin(teams, eq(projects.teamId, teams.id))
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new WorkItemAccessError('Project does not exist.');
    const [organizationMembership] = await this.database
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, project.organizationId)))
      .limit(1);
    if (!organizationMembership) throw new WorkItemAccessError();
    const [teamMembership] = await this.database
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(projects, eq(projects.teamId, teamMemberships.teamId))
      .where(and(eq(projects.id, projectId), eq(teamMemberships.userId, userId)))
      .limit(1);
    const [projectMembership] = await this.database
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
      .limit(1);
    const isOrgAdmin = ['owner', 'admin'].includes(organizationMembership.role);
    const canView = isOrgAdmin || Boolean(teamMembership) || Boolean(projectMembership);
    if (!canView) throw new WorkItemAccessError();
  }

  private async requireContributor(userId: string, projectId: string, writable = false): Promise<void> {
    await this.requireViewer(userId, projectId);
    const [project] = await this.database.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const [orgMembership] = await this.database.select({ role: organizationMemberships.role }).from(organizationMemberships).innerJoin(teams, eq(teams.organizationId, organizationMemberships.organizationId)).where(and(eq(teams.id, project!.teamId), eq(organizationMemberships.userId, userId))).limit(1);
    if (['owner', 'admin'].includes(orgMembership?.role ?? '')) {
      if (writable) await this.requireWritableProject(projectId);
      return;
    }
    const [membership] = await this.database
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
      .limit(1);
    const [teamMembership] = await this.database
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, project!.teamId), eq(teamMemberships.userId, userId)))
      .limit(1);
    if (!['owner', 'admin'].includes(membership?.role ?? '') && !['lead', 'member'].includes(teamMembership?.role ?? '') && membership?.role !== 'maintainer' && membership?.role !== 'contributor') {
      throw new WorkItemAccessError('Contributor access is required.');
    }
    if (writable) await this.requireWritableProject(projectId);
  }

  private async requireReviewer(userId: string, projectId: string, writable = false): Promise<void> {
    await this.requireViewer(userId, projectId);
    const [project] = await this.database.select({ teamId: projects.teamId, organizationId: teams.organizationId }).from(projects).innerJoin(teams, eq(teams.id, projects.teamId)).where(eq(projects.id, projectId)).limit(1);
    const [org] = await this.database.select({ role: organizationMemberships.role }).from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, project!.organizationId), eq(organizationMemberships.userId, userId))).limit(1);
    const [team] = await this.database.select({ role: teamMemberships.role }).from(teamMemberships).where(and(eq(teamMemberships.teamId, project!.teamId), eq(teamMemberships.userId, userId))).limit(1);
    const [membership] = await this.database.select({ role: projectMemberships.role }).from(projectMemberships).where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId))).limit(1);
    if (!['owner', 'admin'].includes(org?.role ?? '') && team?.role !== 'lead' && !['owner', 'admin', 'maintainer'].includes(membership?.role ?? '')) throw new WorkItemAccessError('Reviewer access is required.');
    if (writable) await this.requireWritableProject(projectId);
  }

  private async requireWritableProject(projectId: string): Promise<void> {
    const [project] = await this.database.select({ organizationId: teams.organizationId })
      .from(projects).innerJoin(teams, eq(teams.id, projects.teamId))
      .where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new WorkItemAccessError('Project does not exist.');
    await this.entitlements.assertCanWrite(project.organizationId);
  }
}

function createAcceptanceItems(criteria: string[], legacy = false): AcceptanceItem[] {
  return criteria.map((text, index) => ({
    id: legacy ? `legacy-${index + 1}` : randomUUID(),
    text,
    required: true,
    status: 'unverified',
    comment: '',
    evidence: [],
    reviewedBy: null,
    reviewedAt: null,
  }));
}

function normalizeAcceptanceItems<T extends { acceptanceCriteria: string[]; acceptanceItems: AcceptanceItem[] }>(item: T): T {
  if (item.acceptanceItems.length > 0 || item.acceptanceCriteria.length === 0) return item;
  return { ...item, acceptanceItems: createAcceptanceItems(item.acceptanceCriteria, true) };
}

function sameCriteria(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((criterion, index) => criterion === right[index]);
}

function hasStructuredAcceptance(item: { acceptanceItems: AcceptanceItem[] }): boolean {
  return item.acceptanceItems.length > 0;
}
