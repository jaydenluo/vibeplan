import React, { useEffect, useRef } from 'react';
import { ContributorBreakdown, type Contributor } from './ContributorBreakdown.js';

export type ProjectAnalyticsData = {
  contributors?: Contributor[];
  taskCount: number;
  completedCount: number;
  completionRate: number;
  averageProgress: number;
  inReviewCount: number;
  overdueCount: number;
  blockedCount: number;
  staleCount: number;
  milestones?: { id: string; title?: string; targetDate?: string | null }[];
  completionTrend: { date: string; count: number }[];
  memberLoads: {
    assigneeId: string | null;
    displayName?: string;
    taskCount: number;
    inProgressCount: number;
    overdueCount: number;
    inReviewCount: number;
    remainingEstimateDays: number;
    actualHours: number | null;
    unknownEstimateCount: number;
  }[];
  scheduleComparisons: {
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
  }[];
};

export function ProjectAnalyticsModal({ data, onClose }: { data: ProjectAnalyticsData; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-panel contribution-modal" role="dialog" aria-modal="true" aria-labelledby="project-analytics-title">
      <div className="modal-heading"><div><p className="eyebrow">项目分析</p><h3 id="project-analytics-title">项目健康与成员负载</h3></div><button ref={closeButton} className="close-button" type="button" onClick={onClose} aria-label="关闭">×</button></div>
      <p className="modal-help">按有效叶子任务统计。验收完成率以批准后已完成的任务计算；执行进度反映当前工作进展。</p>
      <div className="contribution-summary">
        {[
          ['项目任务', data.taskCount], ['验收完成', data.completedCount], ['验收完成率', `${data.completionRate}%`], ['执行进度', `${data.averageProgress}%`],
          ['待验收', data.inReviewCount], ['逾期', data.overdueCount], ['阻塞', data.blockedCount], ['停滞', data.staleCount],
        ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
      {data.taskCount === 0 && <p className="modal-help">当前项目暂无任务。</p>}
      <h4>近 7 天验收批准趋势</h4><p className="modal-help">按 UTC 日期记录每次验收批准，重新打开后仍保留历史。</p>
      <div className="contribution-table-wrap"><table className="contribution-table" aria-label="近 7 天验收批准趋势（UTC）">
        <thead><tr><th scope="col">日期（UTC）</th><th scope="col">批准次数</th></tr></thead>
        <tbody>{data.completionTrend.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.count}</td></tr>)}</tbody>
      </table></div>
      <ContributorBreakdown contributors={data.contributors ?? []} />
      <h4>成员当前负载</h4><p className="modal-help">剩余估算以天计，实际工时以小时计。成员贡献可用于协作复盘。</p>
      {data.memberLoads.length === 0 ? <p className="modal-help">暂无当前负载。</p> : <div className="contribution-table-wrap"><table className="contribution-table" aria-label="成员当前负载">
        <thead><tr><th scope="col">成员</th><th scope="col">任务</th><th scope="col">进行中</th><th scope="col">逾期</th><th scope="col">待验收</th><th scope="col">剩余估算（天）</th><th scope="col">实际工时（小时）</th></tr></thead>
        <tbody>{data.memberLoads.map((member) => <tr key={member.assigneeId ?? '__unassigned__'}>
          <th scope="row"><span className="contribution-member">{member.assigneeId === null ? '未分配' : member.displayName || member.assigneeId}</span></th>
          <td>{member.taskCount}</td><td>{member.inProgressCount}</td><td>{member.overdueCount}</td><td>{member.inReviewCount}</td>
          <td>{number(member.remainingEstimateDays)} 天{member.unknownEstimateCount > 0 && <small>{member.unknownEstimateCount} 个任务未估算</small>}</td>
          <td>{quantity(member.actualHours, '小时')}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}

export function TaskScheduleComparison({ taskId, data }: { taskId: string; data: ProjectAnalyticsData | null }) {
  const comparison = data?.scheduleComparisons.find((item) => item.taskId === taskId);
  if (!comparison) return <section className="task-support-panel task-overview-section task-schedule-section"><div className="task-overview-section-heading"><span className="eyebrow">排期核对</span><h4>计划与实际</h4></div><p>计划与实际信息未记录。</p></section>;
  const rows = [
    ['计划截止', comparison.plannedDueDate ?? '未记录'],
    ['实际开始', dateTime(comparison.startedAt)],
    ['实际完成', dateTime(comparison.actualCompletedAt)],
    ['预估', quantity(comparison.estimateDays, '天')],
    ['实际工时', quantity(comparison.actualHours, '小时')],
    ['计划进度', quantity(comparison.plannedProgress, '%', false)],
    ['执行进度', `${number(comparison.actualProgress)}%`],
    ['进度偏差', comparison.progressVariance === null ? '未记录' : `${comparison.progressVariance > 0 ? '+' : ''}${number(comparison.progressVariance)} 个百分点`],
  ];
  return <section className="task-support-panel task-overview-section task-schedule-section"><div className="task-overview-section-heading"><span className="eyebrow">排期核对</span><h4>计划与实际</h4></div>
    <dl>{rows.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    <p>预估按天记录，实际工时按小时记录。计划进度按实际开始至计划截止计算。</p>
    {comparison.completionHistory.length > 0 && <><h5>历史验收批准</h5><ul>{comparison.completionHistory.map((date, index) => <li key={`${date}-${index}`}><time dateTime={date}>{dateTime(date)}</time></li>)}</ul><small>重新打开任务会保留历史验收批准，实际完成以当前已完成状态为准。</small></>}
  </section>;
}

function number(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function quantity(value: number | null, unit: string, space = true): string {
  return value === null ? '未记录' : `${number(value)}${space ? ' ' : ''}${unit}`;
}

function dateTime(value: string | null): string {
  if (!value) return '未记录';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC` : '未记录';
}
