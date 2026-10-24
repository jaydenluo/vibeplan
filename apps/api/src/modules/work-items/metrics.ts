import { calculatePlannedProgress, calculateRiskFlags, normalizeProgress } from './health.js';

export type MetricsTask = {
  id: string;
  parentId?: string | null;
  status: string;
  progress?: number | null;
  estimate?: number | null;
  actualHours?: number | string | null;
  assigneeId?: string | null;
  startedAt?: string | Date | null;
  dueDate?: string | null;
  updatedAt?: string | Date | null;
  riskFlags?: string[];
};

export type MetricsEvent = {
  workItemId: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string | Date;
};

export type MemberLoad = {
  assigneeId: string | null;
  taskCount: number;
  inProgressCount: number;
  overdueCount: number;
  inReviewCount: number;
  remainingEstimateDays: number;
  actualHours: number | null;
  unknownEstimateCount: number;
};

export type ScheduleComparison = {
  taskId: string;
  estimateDays: number | null;
  actualHours: number | null;
  startedAt: string | null;
  plannedDueDate: string | null;
  actualCompletedAt: string | null;
  completionHistory: string[];
  plannedProgress: number | null;
  actualProgress: number;
  progressVariance: number | null;
};

export type ProjectMetrics = {
  taskCount: number;
  completedCount: number;
  completionRate: number;
  averageProgress: number;
  inReviewCount: number;
  overdueCount: number;
  blockedCount: number;
  staleCount: number;
  completionTrend: { date: string; count: number }[];
  memberLoads: MemberLoad[];
  scheduleComparisons: ScheduleComparison[];
};

function timestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nonnegativeNumber(value: number | string | null | undefined): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Aggregate current active leaves. Approval history remains historical after reopening.
 * Estimates are days; actual hours are never converted to estimate units.
 */
export function calculateProjectMetrics(tasks: readonly MetricsTask[], events: readonly MetricsEvent[], now = new Date()): ProjectMetrics {
  const activeTasks = tasks.filter((task) => task.status !== 'cancelled');
  const parents = new Set(activeTasks.map((task) => task.parentId).filter(Boolean));
  const leaves = activeTasks.filter((task) => !parents.has(task.id));
  const leafIds = new Set(leaves.map((task) => task.id));
  const approvals = new Map<string, string[]>();
  for (const event of events) {
    if (!leafIds.has(event.workItemId) || event.action !== 'acceptance' || event.payload.decision !== 'approved') continue;
    const date = timestamp(event.createdAt);
    if (!date || new Date(date).getTime() > now.getTime()) continue;
    approvals.set(event.workItemId, [...(approvals.get(event.workItemId) ?? []), date]);
  }
  for (const dates of approvals.values()) dates.sort();

  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const completionTrend = Array.from({ length: 7 }, (_, index) => ({ date: new Date(utcToday - (6 - index) * 86_400_000).toISOString().slice(0, 10), count: 0 }));
  const trendByDate = new Map(completionTrend.map((day) => [day.date, day]));
  for (const dates of approvals.values()) {
    for (const date of dates) {
      const day = trendByDate.get(date.slice(0, 10));
      if (day) day.count += 1;
    }
  }

  let completedCount = 0;
  let totalProgress = 0;
  let inReviewCount = 0;
  let overdueCount = 0;
  let blockedCount = 0;
  let staleCount = 0;
  const memberLoads = new Map<string | null, MemberLoad>();
  const scheduleComparisons: ScheduleComparison[] = [];
  for (const task of leaves) {
    const progress = normalizeProgress({ status: task.status, progress: task.progress });
    const startedAt = timestamp(task.startedAt);
    const completionHistory = approvals.get(task.id) ?? [];
    const completed = task.status === 'done' && completionHistory.length > 0;
    if (completed) completedCount += 1;
    totalProgress += progress;
    const riskFlags = new Set(task.riskFlags ?? calculateRiskFlags({ status: task.status, progress, dueDate: task.dueDate, estimate: task.estimate, startedAt, updatedAt: timestamp(task.updatedAt) }, now));
    const overdue = task.status !== 'done' && riskFlags.has('overdue');
    const blocked = task.status === 'blocked' || (task.status !== 'done' && riskFlags.has('blocked'));
    const stale = task.status !== 'done' && riskFlags.has('stale');
    if (task.status === 'in_review') inReviewCount += 1;
    if (overdue) overdueCount += 1;
    if (blocked) blockedCount += 1;
    if (stale) staleCount += 1;
    const estimate = nonnegativeNumber(task.estimate);
    const actualHours = nonnegativeNumber(task.actualHours);
    const plannedProgress = calculatePlannedProgress(startedAt, task.dueDate, now);
    scheduleComparisons.push({ taskId: task.id, estimateDays: estimate, actualHours, startedAt, plannedDueDate: task.dueDate ?? null, actualCompletedAt: completed ? completionHistory.at(-1)! : null, completionHistory: [...completionHistory], plannedProgress, actualProgress: progress, progressVariance: plannedProgress === null ? null : progress - plannedProgress });

    // Finished work contributes to history and schedule, not current load.
    if (task.status === 'done') continue;
    const assigneeId = task.assigneeId ?? null;
    const load = memberLoads.get(assigneeId) ?? { assigneeId, taskCount: 0, inProgressCount: 0, overdueCount: 0, inReviewCount: 0, remainingEstimateDays: 0, actualHours: null, unknownEstimateCount: 0 };
    load.taskCount += 1;
    if (task.status === 'in_progress') load.inProgressCount += 1;
    if (overdue) load.overdueCount += 1;
    if (task.status === 'in_review') load.inReviewCount += 1;
    if (estimate === null) load.unknownEstimateCount += 1;
    else load.remainingEstimateDays += estimate * (1 - progress / 100);
    if (actualHours !== null) load.actualHours = (load.actualHours ?? 0) + actualHours;
    memberLoads.set(assigneeId, load);
  }
  return { taskCount: leaves.length, completedCount, completionRate: leaves.length ? Math.round(completedCount / leaves.length * 100) : 0, averageProgress: leaves.length ? Math.round(totalProgress / leaves.length) : 0, inReviewCount, overdueCount, blockedCount, staleCount, completionTrend, memberLoads: [...memberLoads.values()], scheduleComparisons };
}
