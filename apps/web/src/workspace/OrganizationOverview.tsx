import { AlertTriangle, CheckCircle2, CircleDot, Clock3, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';

type Overview = {
  summary: { projectCount: number; taskCount: number; averageProgress: number; inProgressCount: number; inReviewCount: number; blockedCount: number; overdueCount: number; staleCount: number };
  statusDistribution: Array<{ status: string; count: number }>;
  completionTrend: Array<{ date: string; count: number }>;
  projects: Array<{ id: string; name: string; progress: number; taskCount: number; overdueCount: number; blockedCount: number; staleCount: number; risk: 'critical' | 'watch' | 'stable' }>;
};

function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Overview>;
  return Boolean(candidate.summary && Array.isArray(candidate.statusDistribution) && Array.isArray(candidate.completionTrend) && Array.isArray(candidate.projects));
}

const statusLabels: Record<string, string> = { backlog: '待规划', ready: '待开始', in_progress: '进行中', blocked: '受阻', in_review: '待审批', done: '已完成' };
const statusColors: Record<string, string> = { backlog: '#b7c1c9', ready: '#93afcb', in_progress: '#6fa8ba', blocked: '#d78982', in_review: '#d4ad58', done: '#8daf82' };

export function OrganizationOverview({ organizationId, onOpenProjects, onOpenApprovals, onOpenProject }: { organizationId: string; onOpenProjects: () => void; onOpenApprovals: () => void; onOpenProject: (projectId: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(() => {
    if (!organizationId) { setData(null); return; }
    setLoading(true); setError('');
    apiRequest<unknown>(`/organizations/${organizationId}/overview`).then((value) => {
      if (!isOverview(value)) throw new Error('组织总览数据格式无效');
      setData(value);
    }).catch((cause) => {
      setError('unavailable');
      if (cause instanceof Error && cause.message === '组织总览数据格式无效') showMessage('组织总览数据暂时不可用。', 'error');
    }).finally(() => setLoading(false));
  }, [organizationId]);
  useEffect(() => { refresh(); }, [refresh]);

  const donut = useMemo(() => {
    if (!data) return '#edf1f3 0 100%';
    const total = data.statusDistribution.reduce((sum, entry) => sum + entry.count, 0);
    if (!total) return '#edf1f3 0 100%';
    let cursor = 0;
    return data.statusDistribution.filter((entry) => entry.count > 0).map((entry) => {
      const end = cursor + entry.count / total * 100;
      const segment = `${statusColors[entry.status] ?? '#b7c1c9'} ${cursor}% ${end}%`;
      cursor = end;
      return segment;
    }).join(', ');
  }, [data]);
  const maxTrend = Math.max(1, ...(data?.completionTrend.map((entry) => entry.count) ?? [0]));

  return <section className="workspace-overview" aria-label="组织工作台">
    <header className="workspace-overview-heading">
      <div><p className="eyebrow">工作区</p><h2>工作台</h2><p className="muted">用当前风险、执行节奏和项目进度安排下一步。</p></div>
      <button className="overview-refresh" type="button" onClick={refresh} disabled={!organizationId || loading} title="刷新工作台"><RefreshCw aria-hidden="true" size={16} />刷新</button>
    </header>
    {!organizationId && <div className="overview-empty">请选择一个组织以查看工作台。</div>}
    {organizationId && !data && <div className="overview-empty">{error ? '暂无组织总览数据。' : '正在汇总组织工作…'}</div>}
    {data && <>
      <div className="overview-action-grid">
        <button type="button" className="overview-action overview-action-progress" onClick={onOpenProjects}><span><CircleDot aria-hidden="true" size={16} />进行中</span><strong>{data.summary.inProgressCount}</strong><small>当前执行任务</small></button>
        <button type="button" className="overview-action overview-action-review" onClick={onOpenApprovals}><span><CheckCircle2 aria-hidden="true" size={16} />待审批</span><strong>{data.summary.inReviewCount}</strong><small>等待验收确认</small></button>
        <button type="button" className="overview-action overview-action-blocked" onClick={onOpenProjects}><span><AlertTriangle aria-hidden="true" size={16} />已阻塞</span><strong>{data.summary.blockedCount}</strong><small>需要排除障碍</small></button>
        <button type="button" className="overview-action overview-action-overdue" onClick={onOpenProjects}><span><Clock3 aria-hidden="true" size={16} />已逾期</span><strong>{data.summary.overdueCount}</strong><small>需要调整计划</small></button>
      </div>

      <div className="overview-main-grid">
        <section className="overview-projects-panel" aria-labelledby="overview-projects-heading">
          <div className="overview-panel-heading"><div><p className="eyebrow">项目态势</p><h3 id="overview-projects-heading">项目进度与风险</h3></div><span>{data.summary.projectCount} 个项目 · {data.summary.taskCount} 个任务</span></div>
          {data.projects.length === 0 ? <div className="overview-panel-empty">当前没有可访问的项目。</div> : <div className="overview-project-list">{data.projects.map((project) => <button key={project.id} type="button" className={`overview-project-row risk-${project.risk}`} aria-label={`查看 ${project.name} 项目`} onClick={() => onOpenProject(project.id)}>
            <div className="overview-project-copy"><strong>{project.name}</strong><span>{project.taskCount} 个任务 · {project.progress}% 完成</span></div>
            <div className="overview-project-progress" aria-label={`${project.name} 完成度 ${project.progress}%`}><span style={{ width: `${project.progress}%` }} /></div>
            <small>{project.risk === 'critical' ? `${project.blockedCount ? `${project.blockedCount} 项阻塞` : ''}${project.blockedCount && project.overdueCount ? ' · ' : ''}${project.overdueCount ? `${project.overdueCount} 项逾期` : ''}` : project.risk === 'watch' ? `${project.staleCount} 项停滞` : '进展正常'}</small>
          </button>)}</div>}
        </section>

        <section className="overview-cadence-panel" aria-labelledby="overview-cadence-heading">
          <div className="overview-panel-heading"><div><p className="eyebrow">执行节奏</p><h3 id="overview-cadence-heading">本周完成</h3></div><span>近 7 天</span></div>
          <div className="overview-trend" role="img" aria-label="近 7 天完成趋势">{data.completionTrend.map((entry) => <div key={entry.date} className="overview-trend-column" title={`${entry.date}：${entry.count} 项完成`}><span style={{ height: `${Math.max(entry.count ? 18 : 5, entry.count / maxTrend * 100)}%` }} /><small>{entry.date.slice(5).replace('-', '/')}</small></div>)}</div>
          <div className="overview-cadence-summary"><strong>{data.summary.averageProgress}%</strong><span>整体执行进度</span><small>{data.summary.staleCount ? `${data.summary.staleCount} 个任务超过 3 天未更新` : '没有停滞任务'}</small></div>
        </section>
      </div>

      <section className="overview-distribution-panel" aria-labelledby="overview-distribution-heading">
        <div className="overview-panel-heading"><div><p className="eyebrow">任务构成</p><h3 id="overview-distribution-heading">状态分布</h3></div><span>按叶子任务统计</span></div>
        <div className="overview-distribution-content"><div className="overview-donut" role="img" aria-label="任务状态分布" style={{ background: `conic-gradient(${donut})` }}><span>{data.summary.taskCount}<small>任务</small></span></div><div className="overview-status-legend">{data.statusDistribution.map((entry) => <div key={entry.status}><i style={{ backgroundColor: statusColors[entry.status] ?? '#b7c1c9' }} /><span>{statusLabels[entry.status] ?? entry.status}</span><strong>{entry.count}</strong></div>)}</div></div>
      </section>
    </>}
  </section>;
}
