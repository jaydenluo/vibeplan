export type ProgressInput = { progress: number | null | undefined; status: string; estimate: number | null | undefined };
export type ProjectProgressInput = ProgressInput & { id: string; parentId: string | null | undefined };
export type ProgressSummary = { progress: number; source: 'manual' | 'children'; plannedProgress: number | null; variance: number | null };
export type RiskInput = { status: string; progress: number; dueDate: string | null | undefined; estimate: number | null | undefined; startedAt?: string | null; updatedAt?: string | null; blocked?: boolean; blockerIds?: readonly string[] };
export type RiskFlag = 'overdue' | 'due_soon' | 'stale' | 'behind_schedule' | 'blocked';

const DAY_MS = 24 * 60 * 60 * 1000;

// Date-only deadlines consistently expire at the end of their UTC day.
function deadlineTime(dueDate: string | null | undefined): number {
  return dueDate ? new Date(`${dueDate}T23:59:59.999Z`).getTime() : NaN;
}

export function calculatePlannedProgress(startedAt: string | null | undefined, dueDate: string | null | undefined, now = new Date()): number | null {
  if (!startedAt || !dueDate) return null;
  const start = new Date(startedAt).getTime();
  const due = deadlineTime(dueDate);
  if (!Number.isFinite(start) || !Number.isFinite(due) || !Number.isFinite(now.getTime())) return null;
  if (due <= start) return now.getTime() >= due ? 100 : 0;
  return Math.round(Math.min(1, Math.max(0, (now.getTime() - start) / (due - start))) * 100);
}

export function normalizeProgress(item: Pick<ProgressInput, 'progress' | 'status'>): number {
  if (item.status === 'backlog' || item.status === 'ready') return 0;
  if (item.status === 'done' || item.status === 'in_review') return 100;
  const value = Number.isFinite(item.progress) ? item.progress! : 0;
  if (item.status === 'in_progress') return Math.min(99, Math.max(1, value));
  return Math.min(100, Math.max(0, value));
}

function childWeight(item: ProgressInput): number {
  return Number.isFinite(item.estimate) && item.estimate! > 0 ? item.estimate! : 1;
}

function summarizeProgress(item: ProgressInput, children: { item: ProgressInput; progress: number }[]): ProgressSummary {
  const weightedChildren = children.filter((child) => child.item.status !== 'cancelled');
  const rawProgress = weightedChildren.length
    ? Math.round(weightedChildren.reduce((sum, child) => sum + child.progress * childWeight(child.item), 0) / weightedChildren.reduce((sum, child) => sum + childWeight(child.item), 0))
    : normalizeProgress(item);
  const progress = item.status === 'done' || item.status === 'in_review' ? 100 : rawProgress;
  const plannedProgress = null;
  return { progress, source: weightedChildren.length ? 'children' : 'manual', plannedProgress, variance: plannedProgress === null ? null : progress - plannedProgress };
}

export function calculateProgressSummary(item: ProgressInput, children: ProgressInput[] = [], now = new Date()): ProgressSummary {
  return summarizeProgress(item, children.map((child) => ({ item: child, progress: normalizeProgress(child) })));
}

/** Resolve all levels once. A cycle back edge is ignored rather than recursing forever. */
export function calculateProjectProgressSummaries(items: readonly ProjectProgressInput[], now = new Date()): Map<string, ProgressSummary> {
  const childrenByParent = new Map<string, ProjectProgressInput[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const children = childrenByParent.get(item.parentId) ?? [];
    children.push(item);
    childrenByParent.set(item.parentId, children);
  }
  const summaries = new Map<string, ProgressSummary>();
  const visiting = new Set<string>();
  function resolve(item: ProjectProgressInput): ProgressSummary {
    const cached = summaries.get(item.id);
    if (cached) return cached;
    visiting.add(item.id);
    const children = (childrenByParent.get(item.id) ?? [])
      .filter((child) => child.status !== 'cancelled' && !visiting.has(child.id))
      .map((child) => ({ item: child, progress: resolve(child).progress }));
    const summary = summarizeProgress(item, children);
    visiting.delete(item.id);
    summaries.set(item.id, summary);
    return summary;
  }
  for (const item of items) resolve(item);
  return summaries;
}

export function calculateRiskFlags(item: RiskInput, now = new Date()): RiskFlag[] {
  if (item.status === 'done' || item.status === 'cancelled') return [];
  const flags: RiskFlag[] = [];
  const remaining = deadlineTime(item.dueDate) - now.getTime();
  if (remaining < 0) flags.push('overdue');
  else if (remaining < 2 * DAY_MS) flags.push('due_soon');
  if (item.updatedAt && now.getTime() - new Date(item.updatedAt).getTime() >= 3 * DAY_MS) flags.push('stale');
  const plannedProgress = calculatePlannedProgress(item.startedAt, item.dueDate, now);
  if (plannedProgress !== null && plannedProgress - item.progress >= 20) flags.push('behind_schedule');
  if (item.blocked || item.blockerIds?.length) flags.push('blocked');
  return flags;
}
