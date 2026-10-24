import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
type MyWorkTask = { id: string; projectId: string; title: string; status: string; priority: string; dueDate: string | null; reason: string };
type WorkQueues = Record<'inProgress' | 'ready' | 'blocked' | 'review' | 'next', MyWorkTask[]>;
type MyWork = Record<'inProgress' | 'ready' | 'blocked' | 'inReview', MyWorkTask[]> & { next: MyWorkTask | null };
const groups: [keyof WorkQueues, string][] = [['inProgress', '进行中'], ['ready', '可开始'], ['blocked', '被阻塞'], ['review', '待验收'], ['next', '建议下一步']];
export function TodayWork({ organizationId, onOpenTask }: { organizationId: string; onOpenTask: (projectId: string, taskId: string) => void }) {
  const [data, setData] = useState<WorkQueues | null>(null);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    if (!organizationId) return;
    apiRequest<MyWork>(`/organizations/${organizationId}/my-work`).then((value) => { if (active) setData({ inProgress: value.inProgress ?? [], ready: value.ready ?? [], blocked: value.blocked ?? [], review: value.inReview ?? [], next: value.next ? [value.next] : [] }); }).catch(() => { if (active) setError('unavailable'); });
    return () => { active = false; };
  }, [organizationId, refreshVersion]);
  useEffect(() => {
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return <section className="today-work"><div className="page-heading"><h3>今日工作</h3><button className="secondary" type="button" onClick={refresh} disabled={!organizationId}>刷新工作</button></div><p className="muted">当前组织内与我相关的执行、依赖和验收事项。</p>{!organizationId ? <p className="muted">选择组织后查看今日工作。</p> : !data ? <p className="muted">{error ? '暂无今日工作数据。' : '正在加载今日工作…'}</p> : <div className="today-work-grid">{groups.map(([key, label]) => <section key={key}><h4>{label} · {data[key]?.length ?? 0}</h4>{!data[key]?.length ? <p className="muted">暂无事项。</p> : data[key].map((task) => <button key={task.id} type="button" className="today-work-task" onClick={() => onOpenTask(task.projectId, task.id)}><strong>{task.title}</strong><small>{task.priority}{task.dueDate ? ` · 截止 ${task.dueDate}` : ''}</small><span>{task.reason}</span></button>)}</section>)}</div>}</section>;
}
