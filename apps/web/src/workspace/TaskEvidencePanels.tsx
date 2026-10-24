import { isHttpEvidence } from './TaskReportForm.js';
import { useState } from 'react';
type Evidence = { label: string; url: string };
export type TaskEvent = { id?: string; actorId?: string; actorName?: string | null; action: string; createdAt: string; payload: Record<string, unknown> };
const actionLabels: Record<string, string> = { created: '创建任务', updated: '更新任务', report: '执行报告', acceptance: '验收记录', acceptance_item_reviewed: '验收记录', work_log: '工作记录' };
const fieldLabels: Record<string, string> = { title: '标题', description: '描述', status: '状态', priority: '优先级', assigneeId: '负责人', dueDate: '计划结束', estimate: '预估天数', progress: '完成度', planMarkdown: '详细计划', acceptanceCriteria: '验收标准', startedAt: '实际开始', actualHours: '实际工时', dependsOn: '前置依赖' };
const stages: Record<string, string> = { analysis: '分析中', implementation: '实现中', testing: '测试中', blocked: '被阻塞', ready_for_review: '准备验收' };

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '未设置';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
function links(value: unknown): Evidence[] {
  return Array.isArray(value) ? value.filter((item): item is Evidence => typeof item?.label === 'string' && typeof item?.url === 'string') : [];
}
export function EvidenceLink({ evidence }: { evidence: Evidence }) { return isHttpEvidence(evidence.url) ? <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.label}</a> : <span>{evidence.label}：{evidence.url}</span>; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }

export function ExecutionEvidence({ events, acceptanceCycle = 1 }: { events: TaskEvent[]; acceptanceCycle?: number }) {
  const report = [...events].reverse().find((event) => event.action === 'report');
  if (!report) return null;
  const payload = report.payload;
  const historical = (payload.acceptanceCycle ?? 1) !== acceptanceCycle;
  return <section className="task-support-panel"><h4>交付证据与剩余事项</h4><p>{historical ? '历史交付报告：保留前轮证据，本轮需重新提交。' : payload.outcome === 'failed' ? '本次执行失败，尚未提交验收。' : payload.outcome === 'blocked' ? '本次执行受阻，等待解除阻塞。' : '已提交交付报告，等待验收。'}</p>
    {links(payload.evidence).map((evidence) => <p key={evidence.url}><EvidenceLink evidence={evidence} /></p>)}
    {strings(payload.warnings).map((warning) => <p key={warning} className="muted">{warning}</p>)}
    {strings(payload.risks).length > 0 && <><h5>已知风险</h5><ul>{strings(payload.risks).map((risk) => <li key={risk}>{risk}</li>)}</ul></>}
    {strings(payload.remainingIssues).length > 0 && <><h5>剩余事项 / 下一步</h5><ul>{strings(payload.remainingIssues).map((issue) => <li key={issue}>{issue}</li>)}</ul></>}
    {Array.isArray(payload.criterionResults) && payload.criterionResults.map((result: { acceptanceItemId: string; result: string; evidence?: Evidence[] }, index) => <div key={index}><strong>验收项 {result.acceptanceItemId}</strong><p>{result.result}</p>{links(result.evidence).map((evidence) => <EvidenceLink key={evidence.url} evidence={evidence} />)}</div>)}
  </section>;
}

export function TaskHistory({ events, title = '任务变更历史' }: { events: TaskEvent[]; title?: string }) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const ordered = [...events].reverse();
  const visible = ordered.filter((event) => filter === 'all' || historyCategory(event) === filter);
  function toggle(id: string) { setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <section className="task-support-panel task-history"><div className="task-history-heading"><h4>{title}</h4><div className="task-history-filters" role="toolbar" aria-label="历史筛选">{historyFilters.map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} className={filter === option.value ? 'active' : ''} onClick={() => setFilter(option.value)}>{option.label}</button>)}</div></div>{events.length === 0 ? <p>暂无变更记录。</p> : visible.length === 0 ? <p>当前筛选暂无记录。</p> : <ol>{visible.map((event, index) => {
    const id = event.id ?? `${event.createdAt}-${index}`;
    const changes = event.payload.changes as Record<string, { before: unknown; after: unknown }> | undefined;
    const isExpanded = expanded.has(id);
    return <li key={id} className={isExpanded ? 'expanded' : ''}><button type="button" className="task-history-event" aria-expanded={isExpanded} onClick={() => toggle(id)}><span className="task-history-event-title"><strong>{actionLabels[event.action] ?? event.action}</strong><small>{event.actorName || event.actorId || '历史操作者未记录'} · {new Date(event.createdAt).toLocaleString('zh-CN')}</small></span><span className="task-history-event-summary">{historySummary(event, changes)}</span><span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span></button>{isExpanded && <div className="task-history-details">{changes ? <dl>{Object.entries(changes).map(([field, change]) => <div key={field}><dt>{fieldLabels[field] ?? field}</dt><dd>{display(change.before)} → {display(change.after)}</dd></div>)}</dl> : event.action === 'updated' && <p>旧记录未保存字段前后值。</p>}{typeof event.payload.changeReason === 'string' && <p>变更原因：{event.payload.changeReason}</p>}{typeof event.payload.executionStage === 'string' && <p>执行阶段：{stages[event.payload.executionStage] ?? event.payload.executionStage}</p>}{typeof event.payload.executionNote === 'string' && <p>{event.payload.executionNote}</p>}{typeof event.payload.comment === 'string' && event.payload.comment && <p>{event.payload.comment}</p>}</div>}</li>;
  })}</ol>}</section>;
}

type HistoryFilter = 'all' | 'updated' | 'report' | 'acceptance' | 'work_log';
const historyFilters: Array<{ value: HistoryFilter; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'updated', label: '字段变更' }, { value: 'report', label: '执行报告' }, { value: 'acceptance', label: '验收记录' }, { value: 'work_log', label: '工作记录' },
];
function historyCategory(event: TaskEvent): HistoryFilter { if (event.action === 'report') return 'report'; if (event.action === 'acceptance' || event.action === 'acceptance_item_reviewed') return 'acceptance'; if (event.action === 'work_log') return 'work_log'; return 'updated'; }
function historySummary(event: TaskEvent, changes?: Record<string, { before: unknown; after: unknown }>) {
  if (event.action === 'report' && typeof event.payload.summary === 'string') return event.payload.summary;
  if (event.action === 'work_log' && typeof event.payload.content === 'string') return event.payload.content;
  if ((event.action === 'acceptance' || event.action === 'acceptance_item_reviewed') && typeof event.payload.comment === 'string' && event.payload.comment) return event.payload.comment;
  if (changes) return `更新 ${Object.keys(changes).length} 个字段`;
  return event.action === 'updated' ? '旧记录未保存字段前后值' : '查看详情';
}
