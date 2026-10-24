type TaskHealth = {
  riskFlags?: string[];
  blockers?: { id: string; title: string }[];
  progressSummary?: { source: string };
};
const labels: Record<string, string> = { overdue: '已逾期', due_soon: '48 小时内到期', stale: '至少 3 天未更新', behind_schedule: '落后计划至少 20 个百分点', blocked: '任务或前置依赖受阻' };

export function TaskHealthPanel({ item }: { item: TaskHealth }) {
  return <section className="task-support-panel task-overview-section task-health-section"><div className="task-overview-section-heading"><span className="eyebrow">执行信号</span><h4>进度来源与风险</h4></div>
    <p>{item.progressSummary?.source === 'children' ? '按子任务估算加权汇总；无估算按权重 1 计入，取消任务不计入。' : '按任务状态及已记录的执行进度计算。'}执行进度 100% 不代表已通过验收。</p>
    <p>{item.riskFlags?.length ? item.riskFlags.map((flag) => labels[flag] ?? flag).join(' · ') : '当前无风险预警。'}</p>
    {!!item.blockers?.length && <ul>{item.blockers.map((blocker) => <li key={blocker.id}>前置任务：{blocker.title}</li>)}</ul>}
  </section>;
}
