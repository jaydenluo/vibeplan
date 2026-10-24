type OverviewStatus = 'backlog' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';

type ProjectInput = {
  id: string;
  name: string;
  items: Array<{ id: string; status: OverviewStatus | string; parentId?: string | null }>;
  metrics: {
    taskCount: number;
    averageProgress: number;
    overdueCount: number;
    blockedCount: number;
    staleCount: number;
    completionTrend: Array<{ date: string; count: number }>;
  };
};

const visibleStatuses = ['backlog', 'ready', 'in_progress', 'blocked', 'in_review', 'done'] as const;
type VisibleStatus = (typeof visibleStatuses)[number];

function leafItems(items: ProjectInput['items']) {
  const active = items.filter((item) => item.status !== 'cancelled');
  const parents = new Set(active.map((item) => item.parentId).filter((id): id is string => Boolean(id)));
  return active.filter((item) => !parents.has(item.id));
}

export function aggregateOrganizationOverview(projects: ProjectInput[]) {
  const statusCounts: Record<VisibleStatus, number> = { backlog: 0, ready: 0, in_progress: 0, blocked: 0, in_review: 0, done: 0 };
  const trendByDate = new Map<string, number>();
  let taskCount = 0;
  let totalProgress = 0;
  let overdueCount = 0;
  let blockedCount = 0;
  let staleCount = 0;

  const projectRows = projects.map((project) => {
    const leaves = leafItems(project.items);
    for (const item of leaves) if (item.status in statusCounts) statusCounts[item.status as VisibleStatus] += 1;
    for (const entry of project.metrics.completionTrend) trendByDate.set(entry.date, (trendByDate.get(entry.date) ?? 0) + entry.count);
    taskCount += project.metrics.taskCount;
    totalProgress += project.metrics.averageProgress * project.metrics.taskCount;
    overdueCount += project.metrics.overdueCount;
    blockedCount += project.metrics.blockedCount;
    staleCount += project.metrics.staleCount;
    const risk = project.metrics.overdueCount || project.metrics.blockedCount ? 'critical' : project.metrics.staleCount ? 'watch' : 'stable';
    return { id: project.id, name: project.name, progress: project.metrics.averageProgress, taskCount: project.metrics.taskCount, overdueCount: project.metrics.overdueCount, blockedCount: project.metrics.blockedCount, staleCount: project.metrics.staleCount, risk };
  }).sort((left, right) => Number(right.risk === 'critical') - Number(left.risk === 'critical') || Number(right.risk === 'watch') - Number(left.risk === 'watch') || left.name.localeCompare(right.name, 'zh-CN'));

  return {
    summary: {
      projectCount: projects.length,
      taskCount,
      averageProgress: taskCount ? Math.round(totalProgress / taskCount) : 0,
      inProgressCount: statusCounts.in_progress,
      inReviewCount: statusCounts.in_review,
      blockedCount,
      overdueCount,
      staleCount,
    },
    statusDistribution: visibleStatuses.map((status) => ({ status, count: statusCounts[status] })),
    completionTrend: [...trendByDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, count]) => ({ date, count })),
    projects: projectRows,
  };
}
