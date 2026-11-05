import { useCallback, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ArrowRight, CircleDot, ClipboardCheck, Play, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import './TodayWork.css';

type MyWorkTask = { id: string; projectId: string; projectName?: string; title: string; status: string; priority: string; dueDate: string | null; reason: string };
type QueueKey = 'inProgress' | 'ready' | 'blocked' | 'inReview';
type MyWork = Record<QueueKey, MyWorkTask[]> & { next: MyWorkTask | null };
type WorkState = { organizationId: string; data: MyWork | null; loading: boolean; error: boolean };
const groups = [
  { key: 'inProgress', label: '进行中', Icon: CircleDot },
  { key: 'ready', label: '可开始', Icon: Play },
  { key: 'blocked', label: '已阻塞', Icon: AlertTriangle },
  { key: 'inReview', label: '待验收', Icon: ClipboardCheck },
] as const;
const defaultOrder: QueueKey[] = ['inProgress', 'inReview', 'blocked', 'ready'];
const previewLimit = 6;

export function TodayWork({ organizationId, onOpenTask }: { organizationId: string; onOpenTask: (projectId: string, taskId: string) => void }) {
  const id = useId();
  const [state, setState] = useState<WorkState>({ organizationId: '', data: null, loading: false, error: false });
  const [selection, setSelection] = useState<{ organizationId: string; key: QueueKey; expanded: boolean } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setState(previous => ({ organizationId, data: organizationId && previous.organizationId === organizationId ? previous.data : null, loading: Boolean(organizationId), error: false }));
    if (!organizationId) {
      setSelection(null);
      return;
    }
    apiRequest<MyWork>(`/organizations/${organizationId}/my-work`).then(value => {
      if (!active) return;
      const data: MyWork = { inProgress: value.inProgress ?? [], ready: value.ready ?? [], blocked: value.blocked ?? [], inReview: value.inReview ?? [], next: value.next ?? null };
      setState({ organizationId, data, loading: false, error: false });
      setSelection(previous => previous?.organizationId === organizationId ? previous : { organizationId, key: defaultOrder.find(key => data[key].length > 0) ?? 'inProgress', expanded: false });
    }).catch(() => {
      if (active) setState(previous => ({ ...previous, loading: false, error: true }));
    });
    return () => { active = false; };
  }, [organizationId, refreshVersion]);

  useEffect(() => {
    if (!organizationId) return;
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [organizationId, refresh]);

  // Tag snapshots by organization so even the render before effect cleanup
  // cannot show another organization's tasks.
  const data = organizationId && state.organizationId === organizationId ? state.data : null;
  const loading = Boolean(organizationId) && (state.organizationId !== organizationId || state.loading);
  const error = state.organizationId === organizationId && state.error;
  const selected = selection?.organizationId === organizationId ? selection : null;
  const activeKey = selected?.key ?? 'inProgress';
  const activeGroup = groups.find(group => group.key === activeKey)!;
  const tasks = data?.[activeKey] ?? [];
  const visibleTasks = selected?.expanded ? tasks : tasks.slice(0, previewLimit);
  const allEmpty = data && groups.every(group => data[group.key].length === 0);
  const today = new Date().toISOString().slice(0, 10);

  function selectGroup(key: QueueKey) { setSelection({ organizationId, key, expanded: false }); }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const targetIndex = event.key === 'ArrowRight' ? (index + 1) % groups.length
      : event.key === 'ArrowLeft' ? (index + groups.length - 1) % groups.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : -1;
    if (targetIndex < 0) return;
    event.preventDefault();
    const target = groups[targetIndex]!;
    selectGroup(target.key);
    document.getElementById(`${id}-tab-${target.key}`)?.focus();
  }

  return <section className="today-work" aria-labelledby={`${id}-heading`}>
    <header className="today-work-heading">
      <div><h3 id={`${id}-heading`}>今日工作</h3><p>当前组织内需要我处理的任务</p></div>
      <button className="today-work-refresh" type="button" aria-label="刷新工作" onClick={refresh} disabled={!organizationId || loading}><RefreshCw aria-hidden="true" size={14} className={loading ? 'is-refreshing' : undefined} /><span>{loading && data ? '正在更新…' : '刷新'}</span></button>
    </header>

    {!organizationId ? <p className="today-work-empty">选择组织后查看今日工作。</p>
      : !data ? <div className="today-work-empty" role="status">{error ? <><span>今日工作加载失败，请重试。</span><button type="button" className="today-work-retry" onClick={refresh}>重试</button></> : '正在加载今日工作…'}</div>
        : <>
          <div className="today-work-update" role="status">{error && '更新失败，当前显示上次加载的内容。'}</div>
          {data.next && <button type="button" className="today-work-next" aria-label={`查看建议任务：${data.next.title}`} onClick={() => onOpenTask(data.next!.projectId, data.next!.id)}>
            <span className="today-work-next-label"><Play aria-hidden="true" size={13} />建议下一步</span>
            <span className="today-work-next-copy"><strong title={data.next.title}>{data.next.title}</strong><small>{data.next.projectName || '未命名项目'}{data.next.reason ? ` · ${data.next.reason}` : ''}</small></span>
            <span className="today-work-next-action">查看任务<ArrowRight aria-hidden="true" size={15} /></span>
          </button>}

          <div className="today-work-queues">
            <div className="today-work-tabs" role="tablist" aria-label="今日工作分类">
              {groups.map(({ key, label, Icon }, index) => <button key={key} id={`${id}-tab-${key}`} type="button" role="tab" aria-selected={activeKey === key} aria-controls={`${id}-panel`} tabIndex={activeKey === key ? 0 : -1} className={`today-work-tab queue-${key}`} onClick={() => selectGroup(key)} onKeyDown={event => navigateTabs(event, index)}><Icon size={14} aria-hidden="true" />{label}<span className="today-work-count">{data[key].length}</span></button>)}
            </div>
            <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${activeKey}`} tabIndex={0}>
              {tasks.length === 0 ? <p className="today-work-empty">{allEmpty ? '当前没有需要你处理的任务。' : `暂无${activeGroup.label}任务。`}</p> : <>
                <div className="today-work-columns" aria-hidden="true"><span>任务名称</span><span>所属项目</span><span>优先级</span><span>截止日期</span></div>
                <ul className="today-work-list">
                  {visibleTasks.map(task => {
                    const overdue = Boolean(task.dueDate && task.dueDate < today);
                    return <li key={task.id}>
                      <button type="button" className="today-work-task" aria-label={`查看任务：${task.title}`} onClick={() => onOpenTask(task.projectId, task.id)}>
                        <strong className="today-work-title" title={task.title}>{task.title}</strong>
                        <span className="today-work-project" title={task.projectName}>{task.projectName || '未命名项目'}</span>
                        <span className={`today-work-priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
                        <span className={`today-work-date${overdue ? ' is-overdue' : ''}`}>{task.dueDate ? <time dateTime={task.dueDate} title={`截止 ${task.dueDate}`}>{task.dueDate.slice(5)}</time> : '未设截止'}{overdue && <small>已逾期</small>}</span>
                      </button>
                      {activeKey === 'blocked' && task.reason && <details className="today-work-blocker"><summary><span>阻塞原因</span><span className="today-work-blocker-preview">{task.reason}</span></summary><p>{task.reason}</p></details>}
                    </li>;
                  })}
                </ul>
                {tasks.length > previewLimit && <button type="button" className="today-work-more" onClick={() => setSelection({ organizationId, key: activeKey, expanded: !selected?.expanded })}>{selected?.expanded ? '收起' : `展开全部 ${tasks.length} 项`}</button>}
              </>}
            </div>
          </div>
        </>}
  </section>;
}
