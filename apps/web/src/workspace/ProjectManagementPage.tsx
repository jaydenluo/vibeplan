import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest, showMessage } from '../api/client.js';
import { WorkItemCreateForm } from './WorkItemCreateForm.js';
import { useProjectEvents } from './useProjectEvents.js';
import { TaskAcceptanceActions } from './TaskAcceptanceActions.js';
import { EvidenceLink, ExecutionEvidence, TaskHistory } from './TaskEvidencePanels.js';
import { TaskHealthPanel } from './TaskHealthPanel.js';
import { ProjectAnalyticsModal, TaskScheduleComparison, type ProjectAnalyticsData } from './ProjectAnalytics.js';
import { ProjectContributors } from './ProjectContributors.js';
import { BatchPlanModal } from './BatchPlanModal.js';

type Project = { id: string; name: string; slug: string; teamId: string; description?: string | null; repositoryUrl?: string | null };
type AcceptanceItemStatus = 'unverified' | 'passed' | 'failed' | 'needs_info';
type AcceptanceItem = { id: string; text: string; required: boolean; status: AcceptanceItemStatus; comment: string; evidence: Array<{ label: string; url: string }>; reviewedBy: string | null; reviewedAt: string | null };
type WorkItem = { id: string; title: string; type: string; status: string; priority: string; progress?: number | null; parentId?: string | null; dueDate?: string | null; assigneeId?: string | null; blockers?: { id: string; title: string }[]; dependsOn?: string[]; description?: string; planMarkdown?: string | null; actualHours?: number | string | null; riskFlags?: string[]; progressSummary?: { progress: number; source: string; variance: number | null }; acceptanceCriteria?: string[]; acceptanceItems?: AcceptanceItem[]; estimate?: number | null; acceptanceCycle?: number; version?: number };
type WorkItemEvent = { workItemId: string; action: string; payload: Record<string, unknown>; createdAt: string };
type TeamMember = { userId: string; email: string; displayName?: string | null; role: string };
type TaskRow = { item: WorkItem; depth: number; hasChildren: boolean; childCount: number; collapsed: boolean };
type TaskSort = 'startDate' | 'priority' | 'status' | 'type';
type TaskDetailTab = 'overview' | 'plan' | 'acceptance' | 'execution' | 'history';
type Props = { projects: Project[]; activeProjectId?: string | null; onBack: () => void; onSelectProject: (projectId: string) => void };

export function ProjectManagementPage({ projects, activeProjectId, onBack, onSelectProject }: Props) {
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<'gantt' | 'detail'>(() => new URLSearchParams(window.location.search).has('task') ? 'detail' : 'gantt');
  const [creating, setCreating] = useState(false);
  const [creatingParent, setCreatingParent] = useState<WorkItem | null>(null);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [pendingSelectionId, setPendingSelectionId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('task'));
  const [directoryWidth, setDirectoryWidth] = useState(readTaskDirectoryWidth);
  const [projectDirectoryCollapsed, setProjectDirectoryCollapsed] = useState(readProjectDirectoryCollapsed);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [health, setHealth] = useState<ProjectAnalyticsData | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [sortBy, setSortBy] = useState<TaskSort>('startDate');
  const [showContributions, setShowContributions] = useState(false);
  const [showBatchPlan, setShowBatchPlan] = useState(false);
  const [ganttToolbarHost, setGanttToolbarHost] = useState<HTMLDivElement | null>(null);
  const [ganttBottomHost, setGanttBottomHost] = useState<HTMLDivElement | null>(null);
  const taskDirectoryRef = useRef<HTMLElement | null>(null);
  const taskViewPanelRef = useRef<HTMLDivElement | null>(null);
  const syncingTaskScrollRef = useRef(false);
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const reload = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      apiRequest<WorkItem[]>(`/projects/${projectId}/work-items`),
      apiRequest<WorkItemEvent[]>(`/projects/${projectId}/events`),
    ]).then(([value, eventValue]) => {
      setItems(value);
      setEvents(eventValue);
      setSelected((current) => value.find((item) => item.id === current?.id) ?? null);
    }).catch(() => undefined);
    apiRequest<typeof health>(`/projects/${projectId}/health`).then(setHealth).catch(() => setHealth(null));
  }, [projectId]);

  useEffect(() => {
    window.localStorage.setItem('vibe-plan.task-directory-width', String(directoryWidth));
  }, [directoryWidth]);

  useEffect(() => {
    window.localStorage.setItem('vibe-plan.project-directory-collapsed', String(projectDirectoryCollapsed));
  }, [projectDirectoryCollapsed]);

  useEffect(() => {
    const next = activeProjectId && projects.some((item) => item.id === activeProjectId) ? activeProjectId : (projects[0]?.id ?? '');
    setProjectId(next);
  }, [activeProjectId, projects]);

  useEffect(() => {
    if (!projectId) { setItems([]); setEvents([]); return; }
    void reload();
  }, [projectId, reload]);
  const connectionState = useProjectEvents(projectId || null, reload);
  useEffect(() => {
    const followLocation = () => {
      const taskId = new URLSearchParams(window.location.search).get('task');
      setPendingSelectionId(taskId);
      if (taskId) setView('detail');
    };
    window.addEventListener('popstate', followLocation);
    return () => window.removeEventListener('popstate', followLocation);
  }, []);

  useEffect(() => {
    if (!project?.teamId) { setMembers([]); return; }
    apiRequest<TeamMember[]>(`/teams/${project.teamId}/members`).then(setMembers).catch(() => setMembers([]));
  }, [project?.teamId]);

  const filteredItems = useMemo(() => filterWorkItems(items, { searchQuery, priority: priorityFilter, status: statusFilter, type: typeFilter, risk: riskFilter }), [items, priorityFilter, riskFilter, searchQuery, statusFilter, typeFilter]);
  const childrenByParent = useMemo(() => {
    const result = new Map<string | null, WorkItem[]>();
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    for (const item of filteredItems) {
      const key = item.parentId && visibleIds.has(item.parentId) ? item.parentId : null;
      result.set(key, [...(result.get(key) ?? []), item]);
    }
    for (const [key, children] of result) result.set(key, children.sort((left, right) => compareWorkItems(left, right, sortBy)));
    return result;
  }, [filteredItems, sortBy]);
  const rows = useMemo(() => flattenRows(childrenByParent, collapsedIds), [childrenByParent, collapsedIds]);
  const syncTaskScroll = useCallback((source: 'directory' | 'view') => {
    if (syncingTaskScrollRef.current) return;
    const directory = taskDirectoryRef.current;
    const viewPanel = taskViewPanelRef.current;
    if (!directory || !viewPanel) return;
    syncingTaskScrollRef.current = true;
    const scrollTop = source === 'directory' ? directory.scrollTop : viewPanel.scrollTop;
    if (source === 'directory') viewPanel.scrollTop = scrollTop;
    else directory.scrollTop = scrollTop;
    syncingTaskScrollRef.current = false;
  }, []);
  useEffect(() => {
    setSelected((current) => current && filteredItems.some((item) => item.id === current.id) ? current : null);
  }, [filteredItems]);

  useEffect(() => {
    if (!pendingSelectionId) return;
    const created = items.find((item) => item.id === pendingSelectionId);
    if (!created) return;
    setSelected(created);
    setPendingSelectionId(null);
  }, [items, pendingSelectionId]);

  function chooseProject(id: string) {
    setProjectId(id);
    setSelected(null);
    setCollapsedIds(new Set());
    onSelectProject(id);
  }

  function openCreateTask(parent: WorkItem | null = null) {
    setCreatingParent(parent);
    setCreating(true);
  }

  function closeCreateTask() {
    setCreating(false);
    setCreatingParent(null);
  }

  async function deleteTask(item: WorkItem) {
    try {
      const result = await apiRequest<{ deletedIds: string[] }>(`/work-items/${item.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: item.version ?? 1 }),
      });
      const deletedIds = new Set(result.deletedIds);
      setItems((current) => current.filter((candidate) => !deletedIds.has(candidate.id)));
      setSelected((current) => current && deletedIds.has(current.id) ? null : current);
      setCollapsedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      reload();
    } catch { /* The request client has shown the failure. */ }
  }

  function toggleTask(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleTaskView(item: WorkItem) {
    setSelected(item);
    setView((current) => current === 'gantt' ? 'detail' : 'gantt');
  }

  async function updateAssignee(item: WorkItem, assigneeId: string) {
    try {
      const descendants = assigneeId
        ? items.filter((candidate) => candidate.id !== item.id && isDescendantOf(candidate, item.id, items) && !candidate.assigneeId)
        : [];
      const updatedItems: WorkItem[] = [];
      const updated = await apiRequest<WorkItem>(`/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assigneeId: assigneeId || null, version: item.version ?? 1 }),
      });
      updatedItems.push(updated);
      for (const child of descendants) {
        updatedItems.push(await apiRequest<WorkItem>(`/work-items/${child.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId, version: child.version ?? 1 }),
        }));
      }
      setItems((current) => current.map((candidate) => updatedItems.find((next) => next.id === candidate.id) ?? candidate));
      setSelected((current) => current ? updatedItems.find((next) => next.id === current.id) ?? current : current);
    } catch { /* The request client has shown the failure. */ }
  }

  async function updateSchedule(item: WorkItem, dueDate: string, estimate: number) {
    const optimistic = { ...item, dueDate, estimate };
    setItems((current) => current.map((candidate) => candidate.id === item.id ? optimistic : candidate));
    setSelected((current) => current?.id === item.id ? optimistic : current);
    try {
      const updated = await apiRequest<WorkItem>(`/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate, estimate, version: item.version ?? 1 }),
      });
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? { ...candidate, dueDate: updated.dueDate, estimate: updated.estimate, version: updated.version } : candidate));
      setSelected((current) => current?.id === updated.id ? { ...current, dueDate: updated.dueDate, estimate: updated.estimate, version: updated.version } : current);
      void reload();
    } catch {
      setItems((current) => current.map((candidate) => candidate.id === item.id ? item : candidate));
      setSelected((current) => current?.id === item.id ? item : current);
    }
  }

  function updateSchedules(changes: Array<{ item: WorkItem; dueDate: string; estimate: number }>) {
    if (changes.length === 0) return;
    const optimisticById = new Map(changes.map(({ item, dueDate, estimate }) => [item.id, { ...item, dueDate, estimate }]));
    setItems((current) => current.map((candidate) => optimisticById.get(candidate.id) ?? candidate));
    setSelected((current) => current ? optimisticById.get(current.id) ?? current : current);
    void Promise.all(changes.map(async ({ item, dueDate, estimate }) => apiRequest<WorkItem>(`/work-items/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate, estimate, version: item.version ?? 1 }),
    }))).then((updatedItems) => {
      const updatedById = new Map(updatedItems.map((item) => [item.id, item]));
      setItems((current) => current.map((candidate) => {
        const updated = updatedById.get(candidate.id);
        return updated ? { ...candidate, dueDate: updated.dueDate, estimate: updated.estimate, version: updated.version } : candidate;
      }));
      setSelected((current) => {
        const updated = current ? updatedById.get(current.id) : undefined;
        return current && updated ? { ...current, dueDate: updated.dueDate, estimate: updated.estimate, version: updated.version } : current;
      });
      void reload();
    }).catch(() => {
      const originalsById = new Map(changes.map(({ item }) => [item.id, item]));
      setItems((current) => current.map((candidate) => {
        const optimistic = optimisticById.get(candidate.id);
        const original = originalsById.get(candidate.id);
        return optimistic && original && candidate.version === optimistic.version ? original : candidate;
      }));
      setSelected((current) => {
        const optimistic = current ? optimisticById.get(current.id) : undefined;
        const original = current ? originalsById.get(current.id) : undefined;
        return current && optimistic && original && current.version === optimistic.version ? original : current;
      });
    });
  }

  async function reviewAcceptanceItem(item: WorkItem, acceptanceItem: AcceptanceItem, review: { status: AcceptanceItemStatus; comment: string; evidence: Array<{ label: string; url: string }> }) {
    try {
      const updated = await apiRequest<WorkItem>(`/work-items/${item.id}/acceptance-items/${acceptanceItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: item.version ?? 1, ...review }),
      });
      setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setSelected((current) => current?.id === updated.id ? updated : current);
    } catch { /* The request client has shown the failure. */ }
  }

  function startDirectoryResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = directoryWidth;
    const resize = (moveEvent: PointerEvent) => setDirectoryWidth(clampTaskDirectoryWidth(startWidth + moveEvent.clientX - startX));
    const stop = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stop);
  }

  function resizeDirectoryWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    const amount = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0;
    if (!amount) return;
    event.preventDefault();
    setDirectoryWidth((current) => clampTaskDirectoryWidth(current + amount));
  }

  return <main className="project-management-shell">
    <header className="project-shell-header"><button className="back-button" type="button" onClick={onBack} aria-label="返回项目列表">‹ <span>返回项目列表</span></button><div className="project-shell-title"><h1>项目管理</h1></div><div className="project-health-center"><span className={`sync-indicator ${connectionState === 'connected' ? 'connected' : 'disconnected'}`} role="status" aria-label={connectionState === 'connected' ? '实时同步已连接' : '实时同步未连接'} title={connectionState === 'connected' ? '实时同步已连接' : connectionState === 'reconnecting' ? '实时同步重连中' : '正在连接实时同步'}><span aria-hidden="true" /></span>{health && <span className="health-summary" title="项目健康度">进度 {health.averageProgress}% · 逾期 {health.overdueCount} · 阻塞 {health.blockedCount} · 停滞 {health.staleCount} · 里程碑 {health.milestones?.length ?? 0}</span>}</div><div className="project-shell-actions"><button className="secondary" type="button" disabled={!health?.completionTrend} onClick={() => setShowAnalytics(true)}>项目分析</button><button className="secondary" type="button" onClick={() => setShowContributions(true)}>成员贡献</button><button className="secondary" type="button" disabled={!projectId} onClick={() => setShowBatchPlan(true)}>执行计划</button><button className="secondary" type="button" onClick={reload}>刷新</button><button className="primary" type="button" onClick={() => openCreateTask()} disabled={!projectId}>新建任务</button></div></header>
    <div className={`project-management-body${projectDirectoryCollapsed ? ' project-directory-collapsed' : ''}`}>
      <aside className={`project-directory${projectDirectoryCollapsed ? ' collapsed' : ''}`} aria-label="项目目录"><div className="directory-heading"><strong>项目目录</strong><span>{projects.length}</span></div><div className="directory-list">{projects.map((item) => <button key={item.id} type="button" className={`directory-item${item.id === projectId ? ' selected' : ''}`} onClick={() => chooseProject(item.id)} aria-label={item.name} title={item.name}><span className="directory-mark" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><span className="directory-item-label"><strong>{item.name}</strong><small>{item.description || '项目'}</small></span></button>)}</div><button className="directory-collapse-toggle" type="button" aria-label={projectDirectoryCollapsed ? '展开项目目录' : '收起项目目录'} title={projectDirectoryCollapsed ? '展开项目目录' : '收起项目目录'} onClick={() => setProjectDirectoryCollapsed((current) => !current)}><span aria-hidden="true">{projectDirectoryCollapsed ? <ChevronRight size={16} strokeWidth={2.25} /> : <ChevronLeft size={16} strokeWidth={2.25} />}</span><span>{projectDirectoryCollapsed ? '展开目录' : '收起目录'}</span></button></aside>
      <section className="project-task-area" aria-label="项目任务"><div className="task-area-header"><TaskFilters items={filteredItems} searchQuery={searchQuery} priority={priorityFilter} status={statusFilter} type={typeFilter} risk={riskFilter} sortBy={sortBy} onSearchChange={setSearchQuery} onPriorityChange={setPriorityFilter} onStatusChange={setStatusFilter} onTypeChange={setTypeFilter} onRiskChange={setRiskFilter} onSortChange={setSortBy} /><div ref={setGanttToolbarHost} className="gantt-batch-toolbar-host" /><div className="task-view-switcher" role="tablist" aria-label="任务视图"><button type="button" role="tab" aria-selected={view === 'gantt'} className={view === 'gantt' ? 'active' : ''} onClick={() => setView('gantt')}>甘特图</button><button type="button" role="tab" aria-selected={view === 'detail'} className={view === 'detail' ? 'active' : ''} onClick={() => setView('detail')}>任务详情</button></div></div><div className={`task-workspace task-workspace-${view}`} style={{ '--task-directory-width': `${directoryWidth}px` } as React.CSSProperties}><TaskDirectory ref={taskDirectoryRef} onScroll={() => syncTaskScroll('directory')} onMessage={showMessage} rows={rows} selected={selected} members={members} onSelect={setSelected} onDoubleClick={toggleTaskView} onToggle={toggleTask} onAssigneeChange={updateAssignee} onScheduleChange={updateSchedule} onCreateSubtask={openCreateTask} onEdit={setEditing} onDelete={deleteTask} /><div className="task-directory-resizer" role="separator" aria-label="调整任务目录宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={startDirectoryResize} onKeyDown={resizeDirectoryWithKeyboard} /> <div ref={taskViewPanelRef} className="task-view-panel" onScroll={() => syncTaskScroll('view')}>{view === 'gantt' ? <GanttChart rows={rows} selectedId={selected?.id ?? null} onSelect={setSelected} onScheduleChange={updateSchedule} onScheduleChanges={updateSchedules} toolbarHost={ganttToolbarHost} bottomHost={ganttBottomHost} /> : <TaskDetailView analytics={health} selected={selected} items={items} members={members} onSelectTask={setSelected} onAcceptanceItemReview={reviewAcceptanceItem} onEdit={setEditing} onUpdated={(updated) => { setItems((current) => current.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); reload(); }} />}</div>{view === 'gantt' && <div ref={setGanttBottomHost} className="gantt-bottom-host" />}</div></section>
    </div>
    {showAnalytics && health && <ProjectAnalyticsModal data={health} onClose={() => setShowAnalytics(false)} />}
    {showBatchPlan && <BatchPlanModal key={projectId} projectName={project?.name ?? '项目'} items={items} onClose={() => setShowBatchPlan(false)} />}
    {showContributions && <ContributionModal projectId={projectId} items={items} members={members} events={events} onClose={() => setShowContributions(false)} />}
    {creating && projectId && <WorkItemCreateForm projectId={projectId} parentId={creatingParent?.id} parentTitle={creatingParent?.title} onCreated={(createdId) => { if (creatingParent) setCollapsedIds((current) => { const next = new Set(current); next.delete(creatingParent.id); return next; }); closeCreateTask(); setPendingSelectionId(createdId ?? null); reload(); }} onCancel={closeCreateTask} />}
    {editing && projectId && <WorkItemCreateForm projectId={projectId} item={editing} onUpdated={(updated) => { setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate)); setSelected((current) => current?.id === updated.id ? updated : current); setEditing(null); reload(); }} onCancel={() => setEditing(null)} />}
  </main>;
}

function isDescendantOf(item: WorkItem, ancestorId: string, items: WorkItem[]) {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  let parentId = item.parentId ?? null;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function ContributionModal({ projectId, items, members, events, onClose }: { projectId: string; items: WorkItem[]; members: TeamMember[]; events: WorkItemEvent[]; onClose: () => void }) {
  const stats = buildContributionStats(items, members, events);
  const totalContribution = stats.reduce((sum, member) => sum + member.contributionDays, 0);
  const completedTasks = stats.reduce((sum, member) => sum + member.completedTasks, 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-panel contribution-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-modal-title"><div className="modal-heading"><div><p className="eyebrow">项目分析</p><h3 id="contribution-modal-title">成员贡献统计</h3></div><button className="close-button" type="button" onClick={onClose} aria-label="关闭">×</button></div><p className="modal-help">下方按计划天数与交接前后的完成度增量推算贡献，实际工时由作者工作记录独立统计。</p><div className="contribution-summary"><div><strong>{items.length}</strong><span>项目任务</span></div><div><strong>{completedTasks}</strong><span>已完成任务</span></div><div><strong>{formatContributionDays(totalContribution)}</strong><span>推算贡献（计划天数）</span></div></div>{stats.length === 0 ? <p className="modal-help">当前项目还没有团队成员。</p> : <div className="contribution-table-wrap"><table className="contribution-table"><thead><tr><th>成员</th><th>参与任务</th><th>完成</th><th>完成度</th><th>推算贡献（计划天数）</th></tr></thead><tbody>{stats.map((member) => <tr key={member.userId}><th scope="row"><span className="contribution-member">{member.displayName}</span></th><td>{member.assignedTasks} 个任务</td><td>{member.completedTasks} 个</td><td><span className="contribution-progress">{member.averageProgress}%</span></td><td>{formatContributionDays(member.contributionDays)} 天</td></tr>)}</tbody></table></div>}<ProjectContributors projectId={projectId} /></section></div>;
}

function TaskFilters({ items, searchQuery, priority, status, type, risk, sortBy, onSearchChange, onPriorityChange, onStatusChange, onTypeChange, onRiskChange, onSortChange }: { items: WorkItem[]; searchQuery: string; priority: string; status: string; type: string; risk: string; sortBy: TaskSort; onSearchChange: (value: string) => void; onPriorityChange: (value: string) => void; onStatusChange: (value: string) => void; onTypeChange: (value: string) => void; onRiskChange: (value: string) => void; onSortChange: (value: TaskSort) => void }) {
  const statusOptions = ['backlog', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled'];
  const typeOptions = ['feature', 'bug', 'improvement', 'refactor', 'documentation', 'research', 'chore'];
  const sortHasValue = sortBy !== 'startDate';
  return <div className="task-filters" aria-label="任务筛选与排序"><label className="task-search"><span className="sr-only">搜索任务</span><input placeholder="搜索任务标题或描述" value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} /></label><ClearableFilterSelect label="优先级筛选" value={priority} onChange={onPriorityChange} options={[['all', '全部优先级'], ...['P0', 'P1', 'P2', 'P3', 'P4'].map((value) => [value, value])]} /><ClearableFilterSelect label="状态筛选" value={status} onChange={onStatusChange} options={[['all', '全部状态'], ...statusOptions.map((value) => [value, statusLabel(value)])]} /><ClearableFilterSelect label="类型筛选" value={type} onChange={onTypeChange} options={[['all', '全部类型'], ...typeOptions.map((value) => [value, typeLabel(value)])]} /><ClearableFilterSelect label="风险筛选" value={risk} onChange={onRiskChange} options={[['all', '全部风险'], ['overdue', '已逾期'], ['due_soon', '即将逾期'], ['blocked', '依赖阻塞'], ['normal', '正常'], ['stale', '长期未更新'], ['behind_schedule', '进度落后']]} /><label className={`task-filter-select${sortHasValue ? ' has-value' : ''}`}><span className="sr-only">排序方式</span><select aria-label="排序方式" value={sortBy} onChange={(event) => onSortChange(event.target.value as TaskSort)}><option value="startDate">开始时间</option><option value="priority">优先级</option><option value="status">状态</option><option value="type">类型</option></select>{sortHasValue ? <button className="task-filter-clear" type="button" aria-label="清除排序方式" title="清除排序方式" onMouseDown={(event) => event.preventDefault()} onClick={() => onSortChange('startDate')}>×</button> : <span className="task-filter-chevron" aria-hidden="true">⌄</span>}</label><span className="filter-result-count">{items.length} 项</span></div>;
}

export function TaskBoardSummary({ items }: { items: WorkItem[] }) {
  const activeCount = items.filter((item) => item.status === 'in_progress').length;
  const riskCount = items.filter((item) => (item.riskFlags?.length ?? 0) > 0).length;
  const averageProgress = items.length ? Math.round(items.reduce((total, item) => total + progressValue(item), 0) / items.length) : 0;
  return <section className="task-board-summary" aria-label="任务统计"><div><strong>{items.length} 项任务</strong><span>当前结果</span></div><div><strong>{activeCount} 项进行中</strong><span>正在执行</span></div><div className={riskCount ? 'has-risk' : ''}><strong>{riskCount} 项风险</strong><span>需要关注</span></div><div><strong>平均进度 {averageProgress}%</strong><span>整体完成度</span></div></section>;
}

function ClearableFilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  const hasValue = value !== 'all';
  return <label className={`task-filter-select${hasValue ? ' has-value' : ''}`}><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>{hasValue ? <button className="task-filter-clear" type="button" aria-label={`清除${label}`} title={`清除${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange('all')}>×</button> : <span className="task-filter-chevron" aria-hidden="true">⌄</span>}</label>;
}

type GanttScheduleChange = (item: WorkItem, dueDate: string, estimate: number) => void;
type GanttScheduleChanges = (changes: Array<{ item: WorkItem; dueDate: string; estimate: number }>) => void;
type BatchGanttScheduleChange = (item: WorkItem, dueDate: string, estimate: number, moveDescendants?: boolean) => void;
type GanttContextMenu = { item: WorkItem; date: Date; left: number; top: number };
const GANTT_ZOOM_LEVELS = [8, 10, 12, 14, 16, 18, 22, 26, 30, 34, 38];
const GANTT_DEFAULT_ZOOM = 10;
const GANTT_PINCH_THRESHOLD = 1.35;
const GANTT_TRACKPAD_PINCH_DELTA = 180;
const GANTT_TRACKPAD_PINCH_IDLE_MS = 180;

function GanttChartLegacy({ rows, selectedId, onSelect, onScheduleChange }: { rows: TaskRow[]; selectedId: string | null; onSelect: (item: WorkItem) => void; onScheduleChange: GanttScheduleChange }) {
  const [dates] = useState(() => buildDateRange(rows.map((row) => row.item)));
  const [zoomIndex, setZoomIndex] = useState(GANTT_DEFAULT_ZOOM);
  const pinchRef = useRef<{ distance: number; zoomIndex: number } | null>(null);
  const wheelPinchRef = useRef({ delta: 0, zoomed: false, timer: null as number | null });
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayWidth = GANTT_ZOOM_LEVELS[zoomIndex];
  const dateColumns = { gridTemplateColumns: `repeat(${dates.length}, ${dayWidth}px)` };
  const ganttGridStyle = { '--gantt-days': dates.length, '--gantt-day-width': `${dayWidth}px` } as React.CSSProperties;
  const [contextMenu, setContextMenu] = useState<GanttContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);
  useEffect(() => () => { if (wheelPinchRef.current.timer !== null) window.clearTimeout(wheelPinchRef.current.timer); }, []);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const preventPagePinch = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
    scroll.addEventListener('wheel', preventPagePinch, { passive: false });
    return () => scroll.removeEventListener('wheel', preventPagePinch);
  }, []);

  function openContextMenu(event: React.MouseEvent<HTMLDivElement>, item: WorkItem) {
    event.preventDefault();
    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const dayWidth = rect.width / Math.max(1, dates.length);
    const rawDayIndex = dayWidth > 0 ? Math.floor((event.clientX - rect.left) / dayWidth) : 0;
    const dayIndex = Math.max(0, Math.min(dates.length - 1, Number.isFinite(rawDayIndex) ? rawDayIndex : 0));
    setContextMenu({ item, date: dates[dayIndex], left: event.clientX, top: event.clientY });
  }

  function insertTimePoint() {
    if (!contextMenu) return;
    onScheduleChange(contextMenu.item, formatISODate(contextMenu.date), 1);
    setContextMenu(null);
  }

  function changeZoom(delta: number) {
    setZoomIndex((current) => Math.max(0, Math.min(GANTT_ZOOM_LEVELS.length - 1, current + delta)));
  }

  function handleWheelZoom(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const pinch = wheelPinchRef.current;
    if (pinch.timer !== null) window.clearTimeout(pinch.timer);
    pinch.timer = window.setTimeout(() => { pinch.delta = 0; pinch.zoomed = false; pinch.timer = null; }, GANTT_TRACKPAD_PINCH_IDLE_MS);
    if (pinch.zoomed) return;
    if (pinch.delta !== 0 && Math.sign(pinch.delta) !== Math.sign(event.deltaY)) pinch.delta = 0;
    pinch.delta += event.deltaY;
    if (Math.abs(pinch.delta) < GANTT_TRACKPAD_PINCH_DELTA) return;
    pinch.zoomed = true;
    pinch.delta = 0;
    changeZoom(event.deltaY < 0 ? 1 : -1);
  }

  function touchDistance(touches: React.TouchList) {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) pinchRef.current = { distance: touchDistance(event.touches), zoomIndex };
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length < 2) return;
    const distance = touchDistance(event.touches);
    const scale = distance / Math.max(1, pinch.distance);
    if (scale > 1 / GANTT_PINCH_THRESHOLD && scale < GANTT_PINCH_THRESHOLD) return;
    const delta = scale >= GANTT_PINCH_THRESHOLD ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(GANTT_ZOOM_LEVELS.length - 1, pinch.zoomIndex + delta));
    event.preventDefault();
    pinchRef.current = { distance, zoomIndex: nextIndex };
    setZoomIndex(nextIndex);
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) pinchRef.current = null;
  }

  return <div className="gantt-card">{rows.length === 0 ? <div className="task-tree-empty">这个项目还没有任务，点击右上角新建任务。</div> : <div ref={scrollRef} className="gantt-scroll" onWheel={handleWheelZoom} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}><div className="gantt-zoom-controls" aria-label="甘特图缩放"><button type="button" aria-label="缩小" title="缩小" onClick={() => changeZoom(-1)} disabled={zoomIndex === 0}>−</button><button type="button" aria-label="放大" title="放大" onClick={() => changeZoom(1)} disabled={zoomIndex === GANTT_ZOOM_LEVELS.length - 1}>＋</button><button type="button" aria-label="还原缩放" title="还原缩放" onClick={() => setZoomIndex(GANTT_DEFAULT_ZOOM)} disabled={zoomIndex === GANTT_DEFAULT_ZOOM}>↺</button></div><div className="gantt-grid" style={ganttGridStyle}><div className="gantt-calendar-header"><div className="gantt-calendar" style={dateColumns}>{dates.map((date) => <span key={date.toISOString()} title={formatGanttCalendarDate(date)}><strong>{date.getDate()}</strong><small>{weekday(date)}</small></span>)}</div></div>{rows.map(({ item }) => <GanttRow key={item.id} item={item} selectedId={selectedId} onSelect={onSelect} onScheduleChange={onScheduleChange} onContextMenu={openContextMenu} dates={dates} dateColumns={dateColumns} />)}</div></div>}{contextMenu && <div ref={menuRef} className="gantt-context-menu" role="menu" style={{ left: contextMenu.left, top: contextMenu.top }}><button type="button" role="menuitem" onClick={insertTimePoint}>插入时间点</button></div>}</div>;
}

function GanttRow({ item, selectedId, onSelect, onScheduleChange, onContextMenu, dates, dateColumns }: { item: WorkItem; selectedId: string | null; onSelect: (item: WorkItem) => void; onScheduleChange: GanttScheduleChange; onContextMenu: (event: React.MouseEvent<HTMLDivElement>, item: WorkItem) => void; dates: Date[]; dateColumns: React.CSSProperties }) {
  const dragRef = useRef<{ mode: 'move' | 'resize-start' | 'resize-end'; startX: number; startDate: Date; endDate: Date; duration: number; changed: boolean } | null>(null);
  const [preview, setPreview] = useState<{ startDate: Date; endDate: Date } | null>(null);
  const dueDate = item.dueDate ? parseDate(item.dueDate) : dates[dates.length - 1];
  const duration = Math.max(1, item.estimate ?? 1);
  const startDate = addDays(dueDate, -(duration - 1));
  const shownStart = preview?.startDate ?? startDate;
  const shownEnd = preview?.endDate ?? dueDate;
  const shownDuration = Math.max(1, dayDiff(shownStart, shownEnd) + 1);
  const startIndex = Math.max(0, dayDiff(dates[0], shownStart));
  const visibleDuration = Math.min(shownDuration, Math.max(1, dates.length - startIndex));
  const left = `${(startIndex / dates.length) * 100}%`;
  const width = `${(visibleDuration / dates.length) * 100}%`;
  const trackStyle = { ...dateColumns, '--gantt-days': dates.length } as React.CSSProperties;

  useEffect(() => {
    function move(event: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dayWidth = (document.querySelector('.gantt-track') as HTMLElement | null)?.getBoundingClientRect().width! / Math.max(1, dates.length);
      const delta = Math.round((event.clientX - drag.startX) / Math.max(1, dayWidth));
      if (delta === 0 && !drag.changed) return;
      drag.changed = true;
      let nextStart = drag.startDate;
      let nextEnd = drag.endDate;
      if (drag.mode === 'move') { nextStart = addDays(drag.startDate, delta); nextEnd = addDays(drag.endDate, delta); }
      if (drag.mode === 'resize-start') { nextStart = addDays(drag.startDate, Math.min(delta, drag.duration - 1)); if (nextStart > nextEnd) nextStart = nextEnd; }
      if (drag.mode === 'resize-end') { nextEnd = addDays(drag.endDate, Math.max(delta, -(drag.duration - 1))); if (nextEnd < nextStart) nextEnd = nextStart; }
      setPreview({ startDate: nextStart, endDate: nextEnd });
    }
    function up() {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const next = preview;
      setPreview(null);
      if (drag.changed && next) onScheduleChange(item, formatISODate(next.endDate), Math.max(1, dayDiff(next.startDate, next.endDate) + 1));
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    }
    if (dragRef.current) {
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dates.length, item, onScheduleChange, preview]);

  function startDrag(mode: 'move' | 'resize-start' | 'resize-end', event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, startX: event.clientX, startDate, endDate: dueDate, duration, changed: false };
    setPreview({ startDate, endDate: dueDate });
  }

  return <div className={`gantt-row${selectedId === item.id ? ' selected' : ''}`}><div className="gantt-track" style={trackStyle} onContextMenu={(event) => onContextMenu(event, item)}><div className="gantt-track-lines" style={trackStyle} /><button type="button" aria-label={item.title} title={`${item.title} · ${progressLabel(item)} · ${shownDuration} 天`} className={`gantt-bar status-${item.status}`} style={{ left, width }} onClick={() => onSelect(item)} onMouseDown={(event) => startDrag('move', event)}><span className="gantt-resize-handle start" aria-label="调整开始时间" onMouseDown={(event) => startDrag('resize-start', event)} /><span className="gantt-bar-title">{item.title}</span><span className="gantt-bar-progress">{progressLabel(item)}</span><span className="gantt-bar-duration"><b>{shownDuration}</b><small> 天</small></span><span className="gantt-resize-handle end" aria-label="调整结束时间" onMouseDown={(event) => startDrag('resize-end', event)} /></button></div></div>;
}

function GanttChart({ rows, selectedId, onSelect, onScheduleChange, onScheduleChanges, toolbarHost, bottomHost }: { rows: TaskRow[]; selectedId: string | null; onSelect: (item: WorkItem) => void; onScheduleChange: GanttScheduleChange; onScheduleChanges: GanttScheduleChanges; toolbarHost: HTMLDivElement | null; bottomHost: HTMLDivElement | null }) {
  const [zoomIndex, setZoomIndex] = useState(GANTT_DEFAULT_ZOOM);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => selectedId ? new Set([selectedId]) : new Set());
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; left: number; top: number; width: number; height: number } | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const [contextMenu, setContextMenu] = useState<GanttContextMenu | null>(null);
  const [rangePadding, setRangePadding] = useState({ before: 0, after: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const calendarHeaderRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ distance: number; zoomIndex: number } | null>(null);
  const wheelPinchRef = useRef({ delta: 0, zoomed: false, timer: null as number | null });
  const dayWidth = GANTT_ZOOM_LEVELS[zoomIndex];
  const [viewportWidth, setViewportWidth] = useState(0);
  const minimumDays = Math.ceil(viewportWidth / dayWidth);
  const dates = useMemo(() => buildDateRange(rows.map((row) => row.item), minimumDays, rangePadding), [rows, minimumDays, rangePadding]);
  const dateColumns = { gridTemplateColumns: `repeat(${dates.length}, ${dayWidth}px)` };
  const ganttGridStyle = { '--gantt-days': dates.length, '--gantt-day-width': `${dayWidth}px` } as React.CSSProperties;
  function syncHorizontalScroll(source: 'gantt' | 'bottom') {
    const gantt = scrollRef.current;
    const bottom = bottomScrollRef.current;
    if (!gantt || !bottom) return;
    if (source === 'gantt') bottom.scrollLeft = gantt.scrollLeft;
    else gantt.scrollLeft = bottom.scrollLeft;
    if (calendarHeaderRef.current) calendarHeaderRef.current.style.transform = `translateX(-${gantt.scrollLeft}px)`;
  }

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const measure = () => setViewportWidth((current) => {
      const next = Math.max(scroll.clientWidth, scroll.parentElement?.clientWidth ?? 0);
      return current === next ? current : next;
    });
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(scroll);
    if (scroll.parentElement) observer?.observe(scroll.parentElement);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [rows.length]);

  useEffect(() => {
    if (selectedId) setSelectedIds((current) => current.size ? current : new Set([selectedId]));
  }, [selectedId]);

  useEffect(() => {
    if (selectedIds.size === 0) return undefined;
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button')) return;
      event.preventDefault();
      const days = event.shiftKey ? 7 : 1;
      void shiftSelection(event.key === 'ArrowLeft' ? -days : days);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [selectedIds, rows]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);
  useEffect(() => () => { if (wheelPinchRef.current.timer !== null) window.clearTimeout(wheelPinchRef.current.timer); }, []);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const preventPagePinch = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
    scroll.addEventListener('wheel', preventPagePinch, { passive: false });
    return () => scroll.removeEventListener('wheel', preventPagePinch);
  }, []);

  function changeZoom(delta: number) {
    setZoomIndex((current) => Math.max(0, Math.min(GANTT_ZOOM_LEVELS.length - 1, current + delta)));
  }

  function extendDateRange(side: 'before' | 'after') {
    setRangePadding((current) => ({ ...current, [side]: current[side] + 7 }));
    if (side === 'after') {
      window.requestAnimationFrame(() => scrollRef.current?.scrollTo?.({ left: scrollRef.current.scrollWidth, behavior: 'smooth' }));
    }
  }

  function openContextMenu(event: React.MouseEvent<HTMLDivElement>, item: WorkItem) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const day = rect.width / Math.max(1, dates.length);
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor((event.clientX - rect.left) / Math.max(1, day))));
    setContextMenu({ item, date: dates[index], left: event.clientX, top: event.clientY });
  }

  function insertTimePoint() {
    if (!contextMenu) return;
    onScheduleChange(contextMenu.item, formatISODate(contextMenu.date), 1);
    setContextMenu(null);
  }

  function touchDistance(touches: React.TouchList) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  }

  function handleWheelZoom(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    const pinch = wheelPinchRef.current;
    if (pinch.timer !== null) window.clearTimeout(pinch.timer);
    pinch.timer = window.setTimeout(() => { pinch.delta = 0; pinch.zoomed = false; pinch.timer = null; }, GANTT_TRACKPAD_PINCH_IDLE_MS);
    if (pinch.zoomed) return;
    if (pinch.delta !== 0 && Math.sign(pinch.delta) !== Math.sign(event.deltaY)) pinch.delta = 0;
    pinch.delta += event.deltaY;
    if (Math.abs(pinch.delta) < GANTT_TRACKPAD_PINCH_DELTA) return;
    pinch.zoomed = true;
    pinch.delta = 0;
    changeZoom(event.deltaY < 0 ? 1 : -1);
  }

  function selectTask(item: WorkItem, event: React.MouseEvent) {
    setSelectedIds((current) => {
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(current);
        next.has(item.id) ? next.delete(item.id) : next.add(item.id);
        return next;
      }
      return new Set([item.id]);
    });
    onSelect(item);
  }

  function tasksWithDescendants(rootIds: Iterable<string>) {
    const items = rows.map((row) => row.item);
    const children = new Map<string, WorkItem[]>();
    for (const item of items) if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
    const expanded = new Set(rootIds);
    const visit = (id: string) => { for (const child of children.get(id) ?? []) { if (!expanded.has(child.id)) { expanded.add(child.id); visit(child.id); } } };
    for (const id of expanded) visit(id);
    return items.filter((item) => expanded.has(item.id) && item.dueDate);
  }

  function selectedWithDescendants() {
    return tasksWithDescendants(selectedIds);
  }

  async function applyChanges(changes: Array<{ item: WorkItem; dueDate: string; estimate: number }>) {
    onScheduleChanges(changes);
  }

  async function shiftSelection(days: number) {
    const changes = selectedWithDescendants().map((item) => ({ item, dueDate: formatISODate(addDays(parseDate(item.dueDate!), days)), estimate: Math.max(1, item.estimate ?? 1) }));
    onScheduleChanges(changes);
  }

  async function setSharedDate(mode: 'start' | 'end') {
    if (!targetDate) return;
    const target = parseDate(targetDate);
    const changes = selectedWithDescendants().map((item) => {
      const estimate = Math.max(1, item.estimate ?? 1);
      return { item, estimate, dueDate: formatISODate(mode === 'start' ? addDays(target, estimate - 1) : target) };
    });
    await applyChanges(changes);
  }

  async function handleRowScheduleChange(item: WorkItem, dueDate: string, estimate: number, moveDescendants = false) {
    if (!moveDescendants || !item.dueDate) {
      await onScheduleChange(item, dueDate, estimate);
      return;
    }
    const offset = dayDiff(parseDate(item.dueDate), parseDate(dueDate));
    const changes = tasksWithDescendants([item.id]).map((candidate) => ({
      item: candidate,
      dueDate: candidate.id === item.id ? dueDate : formatISODate(addDays(parseDate(candidate.dueDate!), offset)),
      estimate: candidate.id === item.id ? estimate : Math.max(1, candidate.estimate ?? 1),
    }));
    await applyChanges(changes);
  }

  function beginMarquee(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('.gantt-bar, .gantt-zoom-controls, .gantt-batch-toolbar')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX - rect.left + event.currentTarget.scrollLeft;
    const startY = event.clientY - rect.top + event.currentTarget.scrollTop;
    setMarquee({ startX, startY, left: startX, top: startY, width: 0, height: 0 });
  }

  useEffect(() => {
    if (!marquee || !scrollRef.current) return undefined;
    const move = (event: MouseEvent) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      const x = event.clientX - rect.left + scroll.scrollLeft;
      const y = event.clientY - rect.top + scroll.scrollTop;
      setMarquee((current) => current ? { ...current, left: Math.min(current.startX, x), top: Math.min(current.startY, y), width: Math.abs(x - current.startX), height: Math.abs(y - current.startY) } : null);
    };
    const up = () => {
      const scroll = scrollRef.current;
      if (scroll && marquee.width > 3 && marquee.height > 3) {
        const selected = new Set<string>();
        scroll.querySelectorAll<HTMLElement>('.gantt-bar[data-work-item-id]').forEach((bar) => {
          const barRect = bar.getBoundingClientRect();
          const hostRect = scroll.getBoundingClientRect();
          const left = barRect.left - hostRect.left + scroll.scrollLeft;
          const top = barRect.top - hostRect.top + scroll.scrollTop;
          if (left < marquee.left + marquee.width && left + barRect.width > marquee.left && top < marquee.top + marquee.height && top + barRect.height > marquee.top) selected.add(bar.dataset.workItemId!);
        });
        setSelectedIds(selected);
      } else if (marquee.width <= 3 && marquee.height <= 3) setSelectedIds(new Set());
      setMarquee(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [marquee]);

  const handlePinchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length < 2) return;
    const distance = touchDistance(event.touches);
    const scale = distance / Math.max(1, pinch.distance);
    if (scale > 1 / GANTT_PINCH_THRESHOLD && scale < GANTT_PINCH_THRESHOLD) return;
    const delta = scale >= GANTT_PINCH_THRESHOLD ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(GANTT_ZOOM_LEVELS.length - 1, pinch.zoomIndex + delta));
    event.preventDefault();
    pinchRef.current = { distance, zoomIndex: nextIndex };
    setZoomIndex(nextIndex);
  };
  const hasSelection = selectedIds.size > 0;
  const zoomControls = <div className="gantt-zoom-controls" aria-label="甘特图缩放"><button type="button" aria-label="缩小" title="缩小" onClick={() => changeZoom(-1)} disabled={zoomIndex === 0}>−</button><button type="button" aria-label="放大" title="放大" onClick={() => changeZoom(1)} disabled={zoomIndex === GANTT_ZOOM_LEVELS.length - 1}>＋</button><button type="button" aria-label="还原缩放" title="还原缩放" onClick={() => setZoomIndex(GANTT_DEFAULT_ZOOM)} disabled={zoomIndex === GANTT_DEFAULT_ZOOM}>↺</button></div>;
  const batchToolbar = <div className={`gantt-batch-toolbar${hasSelection ? '' : ' is-idle'}`} role="toolbar" aria-label="批量调整任务日期">{zoomControls}<strong>{hasSelection ? `已选 ${selectedIds.size} 项` : '未选择任务'}</strong><button type="button" disabled={!hasSelection} onClick={() => void shiftSelection(-1)}>前移 1 天</button><button type="button" disabled={!hasSelection} onClick={() => void shiftSelection(1)}>后移 1 天</button><input type="date" aria-label="批量日期" disabled={!hasSelection} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /><button type="button" disabled={!hasSelection || !targetDate} onClick={() => void setSharedDate('start')}>统一开始</button><button type="button" disabled={!hasSelection || !targetDate} onClick={() => void setSharedDate('end')}>统一结束</button><button type="button" className="gantt-batch-clear" disabled={!hasSelection} onClick={() => setSelectedIds(new Set())}>清除</button></div>;
  const bottomRail = <div className="gantt-bottom-rail"><button className="gantt-range-control gantt-range-control-before" type="button" aria-label="向前扩展 7 天" title="向前显示 7 天" onClick={() => extendDateRange('before')}><ChevronLeft aria-hidden="true" size={18} /></button><div ref={bottomScrollRef} className="gantt-bottom-scroll" onScroll={() => syncHorizontalScroll('bottom')}><div style={{ width: `${dates.length * dayWidth}px`, height: 1 }} /></div><button className="gantt-range-control gantt-range-control-after" type="button" aria-label="向后扩展 7 天" title="向后显示 7 天" onClick={() => extendDateRange('after')}><ChevronRight aria-hidden="true" size={18} /></button></div>;
  return <div className="gantt-card">{toolbarHost ? createPortal(batchToolbar, toolbarHost) : null}{bottomHost ? createPortal(bottomRail, bottomHost) : null}{rows.length === 0 ? <div className="task-tree-empty">这个项目还没有任务，点击右上角新建任务。</div> : <><div className="gantt-calendar-sticky"><div ref={calendarHeaderRef} className="gantt-calendar-header"><div className="gantt-calendar" style={dateColumns}>{dates.map((date) => <span key={date.toISOString()} title={formatGanttCalendarDate(date)}><strong>{date.getDate()}</strong><small>{weekday(date)}</small></span>)}</div></div></div><div ref={scrollRef} className="gantt-scroll" onScroll={() => syncHorizontalScroll('gantt')} onMouseDown={beginMarquee} onWheel={handleWheelZoom} onTouchStart={(event) => { if (event.touches.length === 2) pinchRef.current = { distance: touchDistance(event.touches), zoomIndex }; }} onTouchMove={handlePinchMove} onTouchEnd={(event) => { if (event.touches.length < 2) pinchRef.current = null; }}><div className="gantt-grid" style={ganttGridStyle}>{rows.map(({ item }) => <BatchGanttRow key={item.id} item={item} dates={dates} dateColumns={dateColumns} selected={selectedIds.has(item.id)} onSelect={selectTask} onScheduleChange={handleRowScheduleChange} onContextMenu={openContextMenu} />)}</div>{marquee && <div className="gantt-marquee" style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }} />}</div></>}{contextMenu && <div ref={menuRef} className="gantt-context-menu" role="menu" style={{ left: contextMenu.left, top: contextMenu.top }}><button type="button" role="menuitem" onClick={insertTimePoint}>插入时间点</button></div>}</div>;
}

function BatchGanttRow({ item, dates, dateColumns, selected, onSelect, onScheduleChange, onContextMenu }: { item: WorkItem; dates: Date[]; dateColumns: React.CSSProperties; selected: boolean; onSelect: (item: WorkItem, event: React.MouseEvent) => void; onScheduleChange: BatchGanttScheduleChange; onContextMenu: (event: React.MouseEvent<HTMLDivElement>, item: WorkItem) => void }) {
  const [preview, setPreview] = useState<{ startDate: Date; endDate: Date } | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize-start' | 'resize-end'; startX: number; startDate: Date; endDate: Date; duration: number } | null>(null);
  const dueDate = item.dueDate ? parseDate(item.dueDate) : dates[dates.length - 1];
  const duration = Math.max(1, item.estimate ?? 1);
  const startDate = addDays(dueDate, -(duration - 1));
  const shownStart = preview?.startDate ?? startDate;
  const shownEnd = preview?.endDate ?? dueDate;
  const startIndex = Math.max(0, dayDiff(dates[0], shownStart));
  const shownDuration = Math.max(1, dayDiff(shownStart, shownEnd) + 1);
  const left = `${(startIndex / dates.length) * 100}%`;
  const width = `${(Math.min(shownDuration, Math.max(1, dates.length - startIndex)) / dates.length) * 100}%`;
  function startDrag(mode: 'move' | 'resize-start' | 'resize-end', event: React.MouseEvent) { event.preventDefault(); event.stopPropagation(); dragRef.current = { mode, startX: event.clientX, startDate, endDate: dueDate, duration }; setPreview({ startDate, endDate: dueDate }); }
  useEffect(() => {
    if (!dragRef.current) return undefined;
    const move = (event: MouseEvent) => { const drag = dragRef.current; if (!drag) return; const track = document.querySelector('.gantt-track') as HTMLElement | null; const day = track ? track.getBoundingClientRect().width / Math.max(1, dates.length) : 1; const delta = Math.round((event.clientX - drag.startX) / Math.max(1, day)); const nextStart = drag.mode === 'resize-start' ? addDays(drag.startDate, Math.min(delta, drag.duration - 1)) : drag.mode === 'move' ? addDays(drag.startDate, delta) : drag.startDate; const nextEnd = drag.mode === 'resize-end' ? addDays(drag.endDate, Math.max(delta, -(drag.duration - 1))) : drag.mode === 'move' ? addDays(drag.endDate, delta) : drag.endDate; setPreview({ startDate: nextStart, endDate: nextEnd }); };
    const up = () => { const drag = dragRef.current; const next = preview; dragRef.current = null; setPreview(null); if (drag && next) onScheduleChange(item, formatISODate(next.endDate), Math.max(1, dayDiff(next.startDate, next.endDate) + 1), drag.mode === 'move'); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dates.length, item, onScheduleChange, preview]);
  return <div className={`gantt-row${selected ? ' selected' : ''}`}><div className="gantt-track" style={{ ...dateColumns, '--gantt-days': dates.length } as React.CSSProperties} onContextMenu={(event) => onContextMenu(event, item)}><div className="gantt-track-lines" /><button type="button" data-work-item-id={item.id} aria-label={item.title} title={`${item.title} · ${progressLabel(item)} · ${shownDuration} 天`} className={`gantt-bar status-${item.status}${selected ? ' selected' : ''}`} style={{ left, width }} onClick={(event) => onSelect(item, event)} onMouseDown={(event) => startDrag('move', event)}><span className="gantt-resize-handle start" aria-label="调整开始时间" onMouseDown={(event) => startDrag('resize-start', event)} /><span className="gantt-bar-title">{item.title}</span><span className="gantt-bar-progress">{progressLabel(item)}</span><span className="gantt-bar-duration"><b>{shownDuration}</b><small> 天</small></span><span className="gantt-resize-handle end" aria-label="调整结束时间" onMouseDown={(event) => startDrag('resize-end', event)} /></button></div></div>;
}

const TaskDirectory = forwardRef<HTMLElement, { rows: TaskRow[]; selected: WorkItem | null; members: TeamMember[]; onSelect: (item: WorkItem) => void; onDoubleClick: (item: WorkItem) => void; onToggle: (id: string) => void; onAssigneeChange: (item: WorkItem, assigneeId: string) => void; onScheduleChange: (item: WorkItem, dueDate: string, estimate: number) => Promise<void>; onCreateSubtask: (item: WorkItem) => void; onEdit: (item: WorkItem) => void; onDelete: (item: WorkItem) => void; onMessage: (value: string) => void; onScroll?: () => void }>(function TaskDirectory({ rows, selected, members, onSelect, onDoubleClick, onToggle, onAssigneeChange, onScheduleChange, onCreateSubtask, onEdit, onDelete, onMessage, onScroll }, ref) {
  const [openAssigneeId, setOpenAssigneeId] = useState<string | null>(null);
  const [taskMenu, setTaskMenu] = useState<{ item: WorkItem; left: number; top: number } | null>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!taskMenu) return undefined;
    const close = (event: MouseEvent) => {
      if (!taskMenuRef.current?.contains(event.target as Node)) setTaskMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [taskMenu]);
  useEffect(() => {
    if (!openAssigneeId) return undefined;
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.task-assignee')) setOpenAssigneeId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openAssigneeId]);
  function openTaskMenu(item: WorkItem, left: number, top: number) {
    const menuWidth = 170;
    const menuHeight = 126;
    setTaskMenu({ item, left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)), top: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8)) });
  }
  async function copyTaskToVibe(item: WorkItem) {
    try {
      await copyText(createVibeTaskPrompt(item));
      onMessage('复制成功，请粘贴到AI编辑工具使用。');
    } catch {
      onMessage('复制失败，请检查浏览器剪贴板权限。');
    } finally {
      setTaskMenu(null);
    }
  }
  function openTaskMenuFromButton(item: WorkItem, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    openTaskMenu(item, rect.right - 170, rect.bottom + 4);
  }
  return <aside ref={ref} onScroll={onScroll} className="task-directory" aria-label="任务目录"><div className="task-directory-heading"><strong>任务目录</strong><span>{rows.length} 项</span><span>负责人</span><div className="task-date-heading"><span>日期</span></div><span aria-hidden="true" /></div>{rows.length === 0 ? <div className="task-tree-empty">暂无任务。</div> : rows.map(({ item, depth, hasChildren, childCount, collapsed }) => <TaskTreeItem key={item.id} item={item} depth={depth} hasChildren={hasChildren} childCount={childCount} collapsed={collapsed} selectedId={selected?.id ?? null} members={members} assigneeMenuOpen={openAssigneeId === item.id} onAssigneeMenuOpenChange={(open) => setOpenAssigneeId(open ? item.id : null)} onSelect={onSelect} onDoubleClick={onDoubleClick} onToggle={onToggle} onAssigneeChange={onAssigneeChange} onScheduleChange={onScheduleChange} onContextMenu={(event) => { event.preventDefault(); openTaskMenu(item, event.clientX, event.clientY); }} onMenuOpen={(target) => openTaskMenuFromButton(item, target)} />)}{taskMenu && <div ref={taskMenuRef} className="task-row-menu" role="menu" aria-label={`${taskMenu.item.title} 任务操作`} style={{ left: taskMenu.left, top: taskMenu.top }}><button type="button" role="menuitem" onClick={() => { onEdit(taskMenu.item); setTaskMenu(null); }}>编辑</button><button type="button" role="menuitem" onClick={() => { onCreateSubtask(taskMenu.item); setTaskMenu(null); }}>新建子任务</button><button type="button" role="menuitem" onClick={() => void copyTaskToVibe(taskMenu.item)}>复制任务去Vibe</button><button type="button" role="menuitem" className="task-row-menu-delete" onClick={() => { onDelete(taskMenu.item); setTaskMenu(null); }}>删除</button></div>}</aside>;
});

function TaskDetailView({ analytics, selected, items, members, onSelectTask, onAcceptanceItemReview, onEdit, onUpdated }: { analytics: ProjectAnalyticsData | null; selected: WorkItem | null; items: WorkItem[]; members: TeamMember[]; onSelectTask: (item: WorkItem) => void; onAcceptanceItemReview: (item: WorkItem, acceptanceItem: AcceptanceItem, review: { status: AcceptanceItemStatus; comment: string; evidence: Array<{ label: string; url: string }> }) => void; onEdit: (item: WorkItem) => void; onUpdated: (item: WorkItem) => void }) {
  const [activeTab, setActiveTab] = useState<TaskDetailTab>('overview');
  const [canReview, setCanReview] = useState(false);
  useEffect(() => {
    let active = true;
    setCanReview(false);
    if (!selected) return;
    apiRequest<{ canReview: boolean }>(`/work-items/${selected.id}/permissions`).then((value) => { if (active) setCanReview(value.canReview === true); }).catch(() => {});
    return () => { active = false; };
  }, [selected?.id]);
  const [events, setEvents] = useState<Array<{ actorId?: string; actorName?: string | null; action: string; payload: Record<string, unknown>; createdAt: string }>>([]);
  useEffect(() => {
    let active = true;
    setEvents([]);
    if (!selected) return;
    apiRequest<typeof events>(`/work-items/${selected.id}/events`).then((value) => { if (active) setEvents(value); }).catch(() => { if (active) setEvents([]); });
    return () => { active = false; };
  }, [selected?.id, selected?.version]);
  const tabs: Array<[TaskDetailTab, string]> = [['overview', '概览'], ['plan', '计划'], ['acceptance', '验收'], ['execution', '执行记录'], ['history', '依赖与历史']];
  function renderTabContent() {
    if (!selected) return <div className="inspector-empty"><strong>选择一个任务</strong><span>从左侧任务目录或甘特图选择任务，查看完整详情。</span></div>;
    if (activeTab === 'plan') return <div className="task-detail-tab-content"><TaskPlanReadOnly item={selected} />{!selected.planMarkdown && <div className="task-detail-tab-empty">暂无详细计划。</div>}</div>;
    if (activeTab === 'acceptance') return <div className="task-detail-tab-content"><TaskAcceptanceActions key={`acceptance-${selected.id}`} item={selected} onUpdated={onUpdated} /><TaskAcceptanceSummary item={selected} members={members} canReview={canReview} onAcceptanceItemReview={onAcceptanceItemReview} /></div>;
    if (activeTab === 'execution') return <div className="task-detail-tab-content"><ExecutionStatusSummary item={selected} events={events} /><TaskAcceptanceActions key={`execution-${selected.id}`} mode="execution" item={selected} onUpdated={onUpdated} /><ExecutionEvidence events={events} acceptanceCycle={selected.acceptanceCycle ?? 1} /><WorkLogPanel key={`logs-${selected.id}-${selected.version}`} item={selected} /><TaskHistory title="执行历史" events={events} /></div>;
    if (activeTab === 'history') return <div className="task-detail-tab-content"><TaskDependenciesPanel key={`dependencies-${selected.id}-${selected.version}`} item={selected} items={items} members={members} onSelectTask={onSelectTask} onUpdated={onUpdated} /><TaskHistory events={events} /></div>;
    return <div className="task-detail-tab-content task-detail-overview"><TaskSummary item={selected} events={events} /><TaskHealthPanel item={selected} /><TaskScheduleComparison taskId={selected.id} data={analytics?.scheduleComparisons ? analytics : null} /></div>;
  }
  return <div className="task-detail-content"><div className="task-detail-panel-heading"><strong>任务详情</strong>{selected && <div className="task-detail-tabs" role="tablist" aria-label="任务详情视图">{tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={activeTab === value} className={activeTab === value ? 'active' : ''} onClick={() => setActiveTab(value)}>{label}</button>)}</div>}</div>{selected && <><TaskSummaryHeader item={selected} members={members} onEdit={onEdit} /><TaskExecutionGuide item={selected} /></>}<div className="task-detail-scroll">{renderTabContent()}</div></div>;
}

function ExecutionStatusSummary({ item, events }: { item: WorkItem; events: Array<{ actorName?: string | null; action: string; payload: Record<string, unknown>; createdAt: string }> }) {
  const reports = events.filter((event) => event.action === 'report');
  const latest = reports.at(-1);
  const latestPayload = latest?.payload ?? {};
  const hours = Number(item.actualHours ?? 0);
  const remaining = Array.isArray(latestPayload.remainingIssues) ? latestPayload.remainingIssues.length : 0;
  return <section className="task-execution-summary"><div className="task-execution-summary-heading"><div><p className="eyebrow">执行概览</p><h4>当前执行状态</h4></div><span className={`task-execution-status status-${metaClass(item.status)}`}>{statusLabel(item.status)}</span></div><div className="task-execution-metrics"><div><strong>{progressLabel(item)}</strong><span>当前进度</span></div><div><strong>{Number.isFinite(hours) ? hours : 0} 小时</strong><span>实际工时</span></div><div><strong>{reports.length}</strong><span>执行报告</span></div><div><strong>{remaining}</strong><span>剩余事项</span></div></div>{latest && <p className="task-execution-summary-latest">最近执行：{latestPayload.summary as string || '已提交执行报告'} · {latest.actorName || '执行者未记录'} · {new Date(latest.createdAt).toLocaleString('zh-CN')}</p>}</section>;
}

function TaskAcceptanceSummary({ item, members, canReview, onAcceptanceItemReview }: { item: WorkItem; members: TeamMember[]; canReview: boolean; onAcceptanceItemReview: (item: WorkItem, acceptanceItem: AcceptanceItem, review: { status: AcceptanceItemStatus; comment: string; evidence: Array<{ label: string; url: string }> }) => void }) {
  const acceptanceItems = item.acceptanceItems ?? [];
  if (acceptanceItems.length === 0 && !(item.acceptanceCriteria?.length)) return <section className="task-support-panel"><h4>验收标准</h4><p>暂无验收标准。</p></section>;
  return <section className="task-support-panel"><h4>验收标准</h4>{acceptanceItems.length ? <div className="acceptance-item-list">{acceptanceItems.map((acceptanceItem) => <AcceptanceItemRow canReview={canReview && item.status !== 'done'} key={acceptanceItem.id} item={item} acceptanceItem={acceptanceItem} members={members} onSave={onAcceptanceItemReview} />)}</div> : <ul>{item.acceptanceCriteria?.map((criterion, index) => <li key={`${criterion}-${index}`}>{criterion}</li>)}</ul>}</section>;
}

function TaskSummaryHeader({ item, members, onEdit }: { item: WorkItem; members: TeamMember[]; onEdit: (item: WorkItem) => void }) {
  const assignee = members.find((member) => member.userId === item.assigneeId);
  return <div className="task-detail-summary"><div className="task-detail-summary-title"><h2 aria-label={item.title}><span className={`priority ${item.priority.toLowerCase()}`}>{item.priority}</span>{item.title}</h2><div className="task-detail-summary-meta"><span>类型：{typeLabel(item.type)}</span><span>预估工时：{item.estimate ? `${item.estimate}天` : '未设置'}</span></div></div><dl><div><dt>状态</dt><dd>{statusLabel(item.status)}</dd></div><div><dt>完成度</dt><dd>{progressLabel(item)}</dd></div><div><dt>负责人</dt><dd>{assignee ? memberLabel(assignee) : '未分配'}</dd></div><div><dt>截止日期</dt><dd>{item.dueDate ? formatDate(item.dueDate) : '未设置'}</dd></div></dl><button className="secondary" type="button" onClick={() => onEdit(item)}>编辑任务</button></div>;
}

function TaskExecutionGuide({ item }: { item: WorkItem }) {
  const acceptanceItems = item.acceptanceItems ?? [];
  const pendingAcceptance = acceptanceItems.filter((candidate) => candidate.status !== 'passed').length;
  const riskLabels = (item.riskFlags ?? []).map(riskLabel);
  const nextAction = item.status === 'backlog' || item.status === 'ready'
    ? '任务尚未开始，确认排期和负责人后开始执行。'
    : item.status === 'blocked'
      ? '任务已阻塞，优先处理前置依赖或补充阻塞说明。'
      : item.status === 'in_review'
        ? pendingAcceptance > 0 ? `等待验收，仍有 ${pendingAcceptance} 项验收标准未通过。` : '等待有审核权限的成员完成最终验收。'
        : item.status === 'done'
          ? '任务已完成验收；后续变更应重新打开任务。'
          : pendingAcceptance > 0 ? `继续执行并补齐 ${pendingAcceptance} 项验收标准的证据。` : '提交执行报告，进入验收流程。';
  return <div className="task-execution-guide"><div><span>下一步</span><strong>{nextAction}</strong></div>{riskLabels.length > 0 && <p role="status"><span>风险</span>{riskLabels.join(' · ')}</p>}</div>;
}

function TaskPlanReadOnly({ item }: { item: WorkItem }) {
  if (!item.planMarkdown) return null;
  return <section className="task-plan-readonly"><h4>详细计划</h4><pre>{item.planMarkdown}</pre></section>;
}

function TaskDependenciesPanel({ item, items, members, onSelectTask, onUpdated }: { item: WorkItem; items: WorkItem[]; members: TeamMember[]; onSelectTask: (item: WorkItem) => void; onUpdated: (item: WorkItem) => void }) {
  const [selected, setSelected] = useState<string[]>(item.dependsOn ?? []);
  const [savedSelection, setSavedSelection] = useState<string[]>(item.dependsOn ?? []);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitial, setPickerInitial] = useState<string[] | null>(null);
  const [query, setQuery] = useState('');
  const candidates = items.filter((candidate) => candidate.id !== item.id);
  const dependencies = selected.map((id) => candidates.find((candidate) => candidate.id === id)).filter((candidate): candidate is WorkItem => Boolean(candidate));
  const blocked = dependencies.filter((candidate) => candidate.status !== 'done');
  const available = candidates.filter((candidate) => !selected.includes(candidate.id) && candidate.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const dirty = !sameIds(selected, savedSelection);
  function togglePicker() {
    if (pickerOpen) {
      setSelected(pickerInitial ?? savedSelection);
      setPickerInitial(null);
      setQuery('');
      setPickerOpen(false);
      return;
    }
    setPickerInitial([...selected]);
    setQuery('');
    setPickerOpen(true);
  }
  async function save() {
    setBusy(true);
    try { const updated = await apiRequest<WorkItem>(`/work-items/${item.id}/dependencies`, { method: 'PUT', body: JSON.stringify({ dependsOn: selected }) }); if (updated?.id) onUpdated(updated); setSavedSelection([...selected]); setPickerInitial(null); setPickerOpen(false); }
    catch { /* The request client has shown the failure. */ }
    finally { setBusy(false); }
  }
  return <>
    <section className="task-support-panel task-dependencies">
      <div className="task-support-heading"><div><h4>依赖关系</h4><p>{selected.length === 0 ? '当前任务没有前置依赖。' : blocked.length > 0 ? `有 ${blocked.length} 个未完成依赖，当前任务可能被阻塞。` : `${selected.length} 个前置依赖均已完成。`}</p></div><button type="button" className="secondary compact" disabled={busy} onClick={() => { setPickerInitial([...selected]); setQuery(''); setPickerOpen(true); }}>添加依赖</button></div>
      {dependencies.length > 0 && <div className="task-dependency-list">{dependencies.map((candidate) => { const assignee = members.find((member) => member.userId === candidate.assigneeId); return <article className="task-dependency-row" key={candidate.id}><div className="task-dependency-copy"><strong>{candidate.title}</strong><small>{assignee ? `负责人：${memberLabel(assignee)}` : '未分配负责人'}</small></div><span className={`task-meta-status status-${metaClass(candidate.status)}`}>{statusLabel(candidate.status)}</span><span className="task-progress">{progressLabel(candidate)}</span><span className={candidate.status === 'done' ? 'task-dependency-ok' : 'task-dependency-blocked'}>{candidate.status === 'done' ? '正常' : '阻塞'}</span><button type="button" className="task-dependency-view" onClick={() => onSelectTask(candidate)}>查看任务</button><button type="button" className="task-dependency-remove" aria-label={`移除依赖 ${candidate.title}`} onClick={() => setSelected((current) => current.filter((id) => id !== candidate.id))}>移除依赖</button></article>; })}</div>}
      {dirty && !pickerOpen && <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>保存依赖</button>}
    </section>
    {pickerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) togglePicker(); }}><section className="modal-panel task-dependency-modal" role="dialog" aria-modal="true" aria-label="添加依赖"><div className="modal-heading"><div><p className="eyebrow">任务依赖</p><h3>添加依赖</h3></div><button type="button" className="close-button" aria-label="关闭" onClick={togglePicker}>×</button></div><label><span className="sr-only">搜索依赖任务</span><input aria-label="搜索依赖任务" placeholder="搜索任务标题" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></label><div className="task-dependency-options">{available.length === 0 ? <small>没有可添加的任务。</small> : available.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setSelected((current) => [...current, candidate.id]); setQuery(''); }}>{candidate.title}<span>{statusLabel(candidate.status)}</span></button>)}</div><div className="task-dependency-actions"><button type="button" className="secondary" disabled={busy} onClick={togglePicker}>取消</button><button type="button" className="primary" disabled={busy || !dirty} onClick={() => { setSavedSelection([...selected]); void save(); }}>保存依赖</button></div></section></div>}
  </>;
}

function WorkLogPanel({ item }: { item: WorkItem }) {
  const [hours, setHours] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; hours: number; content: string; workDate: string; actorName?: string | null }>>([]);
  useEffect(() => { apiRequest<typeof logs>(`/work-items/${item.id}/work-logs`).then(setLogs).catch(() => setLogs([])); }, [item.id]);
  async function addLog() {
    if (!hours || !content.trim() || !(Number(hours) > 0)) { showMessage('请填写有效小时数和工作内容。', 'error'); return; }
    setBusy(true);
    try {
      const log = await apiRequest<typeof logs[number]>(`/work-items/${item.id}/work-logs`, { method: 'POST', body: JSON.stringify({ hours: Number(hours), content, workDate: new Date().toISOString().slice(0, 10) }) });
      setLogs((current) => [...current, log]); setHours(''); setContent('');
    } catch { /* The request client has shown the failure. */ }
    finally { setBusy(false); }
  }
  const orderedLogs = [...logs].sort((left, right) => right.workDate.localeCompare(left.workDate));
  const totalHours = logs.reduce((total, log) => total + Number(log.hours || 0), 0);
  return <section className="task-support-panel task-work-logs"><div className="task-support-heading"><div><h4>工作记录</h4><p>累计实际工时：{totalHours} 小时 · {logs.length} 条记录</p></div></div><div className="work-log-form"><input disabled={busy} aria-label="工作时长" type="number" min="0.25" step="0.25" placeholder="小时" value={hours} onChange={(event) => setHours(event.target.value)} /><input disabled={busy} aria-label="工作日志" placeholder="完成了什么" value={content} onChange={(event) => setContent(event.target.value)} /><button type="button" className="secondary" disabled={busy} onClick={() => void addLog()}>记录</button></div><div className="work-log-list">{orderedLogs.length === 0 ? <small>暂无工作记录。</small> : orderedLogs.map((log) => <div className="work-log-entry" key={log.id}><strong>{log.content}</strong><small>{log.workDate} · {log.hours} 小时{log.actorName ? ` · ${log.actorName}` : ''}</small></div>)}</div></section>;
}

function DateCalendar({ label, value, month, onMonthChange, onChange, min, max }: { label: string; value: string; month: Date; onMonthChange: (month: Date) => void; onChange: (value: string) => void; min?: string; max?: string }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1 - first.getDay()));
  const today = formatISODate(new Date());
  return <section className="date-calendar" aria-label={`${label}日历`}><div className="date-calendar-heading"><div className="date-calendar-stepper"><button type="button" aria-label={`${label}上一年`} onClick={() => onMonthChange(new Date(first.getFullYear() - 1, first.getMonth(), 1))}>‹</button><strong>{first.getFullYear()}年</strong><button type="button" aria-label={`${label}下一年`} onClick={() => onMonthChange(new Date(first.getFullYear() + 1, first.getMonth(), 1))}>›</button></div><div className="date-calendar-stepper"><button type="button" aria-label={`${label}上个月`} onClick={() => onMonthChange(new Date(first.getFullYear(), first.getMonth() - 1, 1))}>‹</button><strong>{first.getMonth() + 1}月</strong><button type="button" aria-label={`${label}下个月`} onClick={() => onMonthChange(new Date(first.getFullYear(), first.getMonth() + 1, 1))}>›</button></div></div><div className="date-calendar-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((weekdayName) => <span key={weekdayName}>{weekdayName}</span>)}</div><div className="date-calendar-days">{days.map((day) => { const date = formatISODate(day); const inMonth = day.getMonth() === first.getMonth(); const disabled = Boolean((min && date < min) || (max && date > max)); return <button type="button" key={date} className={`${inMonth ? '' : 'muted '}${date === value ? 'selected ' : ''}${date === today ? 'today' : ''}`} disabled={disabled} onClick={() => onChange(date)}>{day.getDate()}</button>; })}</div></section>;
}

function TaskTreeItem({ item, depth, hasChildren, childCount, collapsed, selectedId, members, assigneeMenuOpen, onAssigneeMenuOpenChange, onSelect, onDoubleClick, onToggle, onAssigneeChange, onScheduleChange, onContextMenu, onMenuOpen }: { item: WorkItem; depth: number; hasChildren: boolean; childCount: number; collapsed: boolean; selectedId: string | null; members: TeamMember[]; assigneeMenuOpen: boolean; onAssigneeMenuOpenChange: (open: boolean) => void; onSelect: (item: WorkItem) => void; onDoubleClick: (item: WorkItem) => void; onToggle: (id: string) => void; onAssigneeChange: (item: WorkItem, assigneeId: string) => void; onScheduleChange: (item: WorkItem, dueDate: string, estimate: number) => Promise<void>; onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void; onMenuOpen: (target: HTMLButtonElement) => void }) {
  const startDate = item.dueDate ? addDays(parseDate(item.dueDate), -(Math.max(1, item.estimate ?? 1) - 1)) : null;
  const endDate = item.dueDate ? parseDate(item.dueDate) : null;
  const assignee = members.find((member) => member.userId === item.assigneeId);
  const [dateEditorOpen, setDateEditorOpen] = useState(false);
  const [startInput, setStartInput] = useState(startDate ? formatInputDate(startDate) : '');
  const [endInput, setEndInput] = useState(endDate ? formatInputDate(endDate) : '');
  const [dateSaving, setDateSaving] = useState(false);
  const [startMonth, setStartMonth] = useState(() => startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [endMonth, setEndMonth] = useState(() => endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [dateEditorPosition, setDateEditorPosition] = useState<{ left: number; top: number; anchorTop?: number; anchorBottom?: number } | null>(null);
  useEffect(() => {
    if (!dateEditorOpen) return undefined;
    const close = (event: MouseEvent) => {
      if (event.target instanceof Element) {
        const clickedCell = event.target.closest('.task-date-cell');
        const belongsToThisTask = clickedCell && Array.from(clickedCell.querySelectorAll<HTMLButtonElement>('.task-date-range')).some((button) => button.getAttribute('aria-label') === `设置日期 ${item.title}`);
        if (belongsToThisTask) return;
      }
      setDateEditorOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [dateEditorOpen, item.title]);
  useLayoutEffect(() => {
    if (!dateEditorOpen) return;
    const editor = document.querySelector<HTMLFormElement>('.task-date-editor');
    if (!editor) return;
    const anchor = Array.from(document.querySelectorAll<HTMLButtonElement>('.task-date-range')).find((button) => button.getAttribute('aria-label') === `设置日期 ${item.title}`);
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const height = editor.getBoundingClientRect().height;
    const width = Math.min(520, window.innerWidth - 24);
    const halfWidth = width / 2;
    const left = Math.min(Math.max(anchorRect.left + anchorRect.width / 2, 12 + halfWidth), window.innerWidth - 12 - halfWidth);
    const belowTop = anchorRect.bottom + 6;
    const aboveTop = anchorRect.top - height - 6;
    const fitsBelow = belowTop + height <= window.innerHeight - 12;
    const nextTop = fitsBelow || aboveTop < 12 ? belowTop : aboveTop;
    setDateEditorPosition((current) => {
      if (current && Math.abs(current.left - left) <= 0.5 && Math.abs(current.top - Math.max(12, nextTop)) <= 0.5) return current;
      return { left, top: Math.max(12, nextTop), anchorTop: anchorRect.top, anchorBottom: anchorRect.bottom };
    });
  }, [dateEditorOpen, dateEditorPosition, item.title]);
  function chooseAssignee(assigneeId: string) {
    onAssigneeChange(item, assigneeId);
    onAssigneeMenuOpenChange(false);
  }
  async function saveDateRange(event: React.FormEvent) {
    event.preventDefault();
    if (!startInput || !endInput) { showMessage('请选择开始日期和结束日期。', 'error'); return; }
    if (endInput < startInput) { showMessage('结束日期不能早于开始日期。', 'error'); return; }
    setDateSaving(true);
    try {
      const duration = Math.max(1, Math.round((parseDate(endInput).getTime() - parseDate(startInput).getTime()) / 86400000) + 1);
      await onScheduleChange(item, endInput, duration);
      setDateEditorOpen(false);
    } finally {
      setDateSaving(false);
    }
  }
  return <div className={`task-tree-item${selectedId === item.id ? ' selected' : ''}`} style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => onSelect(item)} onDoubleClick={() => onDoubleClick(item)} onContextMenu={onContextMenu}><span className="task-tree-toggle-slot">{hasChildren ? <button type="button" className={`task-tree-toggle${collapsed ? ' is-collapsed' : ''}`} aria-label={`${collapsed ? '展开' : '收起'} ${item.title}`} onClick={(event) => { event.stopPropagation(); onToggle(item.id); }} onDoubleClick={(event) => event.stopPropagation()} /> : null}</span><span className="task-priority-stack"><span className={`task-priority ${item.priority.toLowerCase()}`}>{item.priority}</span></span><button type="button" className="task-tree-select" aria-label={`${item.title} ${statusLabel(item.status)} · ${item.type} · ${item.priority}`} onClick={(event) => { event.stopPropagation(); onSelect(item); }} onDoubleClick={(event) => { event.stopPropagation(); onDoubleClick(item); }}><span className="task-tree-copy"><strong className="task-tree-title">{item.title}</strong><small className="task-tree-meta no-wrap"><span className={`task-meta-status status-${metaClass(item.status)}`}>{statusLabel(item.status)}</span><span className="task-meta-divider" aria-hidden="true">·</span><span className={`task-meta-progress type-${metaClass(item.type)} progress-${progressBand(item)}`} style={{ "--task-progress": `${progressValue(item)}%` } as React.CSSProperties}><span>{typeLabel(item.type)}</span><b>{progressLabel(item)}</b></span></small><small className="task-tree-submeta"><span>{item.estimate ? `预估 ${item.estimate} 天` : '未设置工时'}</span><span>{childCount ? `${childCount} 个子任务` : '无子任务'}</span>{item.riskFlags?.length ? <span className="task-tree-risk">{riskLabel(item.riskFlags[0])}</span> : null}</small></span></button><div className="task-assignee"><button type="button" className="task-assignee-trigger" aria-label={`负责人 ${item.title}`} aria-haspopup="menu" aria-expanded={assigneeMenuOpen} onClick={(event) => { event.stopPropagation(); onSelect(item); onAssigneeMenuOpenChange(!assigneeMenuOpen); }} onDoubleClick={(event) => event.stopPropagation()}><span>{assignee ? memberLabel(assignee) : '未分配'}</span></button>{assigneeMenuOpen && <div className="task-assignee-menu" role="menu" aria-label={`${item.title} 负责人选项`}><button type="button" role="menuitem" className={!item.assigneeId ? 'selected' : ''} onClick={() => chooseAssignee('')}>未分配</button>{members.map((member) => <button key={member.userId} type="button" role="menuitem" className={member.userId === item.assigneeId ? 'selected' : ''} onClick={() => chooseAssignee(member.userId)}>{memberLabel(member)}</button>)}</div>}</div><div className="task-date-cell"><button type="button" className="task-date-range" aria-label={`设置日期 ${item.title}`} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); const width = Math.min(520, window.innerWidth - 24); const halfWidth = width / 2; setDateEditorPosition({ left: Math.min(Math.max(rect.left + rect.width / 2, 12 + halfWidth), window.innerWidth - 12 - halfWidth), top: Math.min(Math.max(rect.top + rect.height / 2, 12), window.innerHeight - 12) }); setStartInput(startDate ? formatInputDate(startDate) : ''); setEndInput(endDate ? formatInputDate(endDate) : ''); setStartMonth(startDate ? new Date(startDate.getFullYear(), startDate.getMonth(), 1) : new Date()); setEndMonth(endDate ? new Date(endDate.getFullYear(), endDate.getMonth(), 1) : new Date()); setDateEditorOpen((value) => !value); }} onDoubleClick={(event) => event.stopPropagation()}>{startDate && endDate ? <><span>{formatDateValue(startDate)}</span><span>{formatDateValue(endDate)}</span></> : <span>时间未设置</span>}</button>{dateEditorOpen && <form className="task-date-editor" role="dialog" aria-label={`设置日期 ${item.title}`} style={{ left: `${dateEditorPosition?.left ?? window.innerWidth / 2}px`, top: `${dateEditorPosition?.top ?? window.innerHeight / 2}px` }} onSubmit={(event) => void saveDateRange(event)} onClick={(event) => event.stopPropagation()}><div className="date-calendar-pair"><div><strong className="date-calendar-label">开始日期</strong><input className="date-calendar-input" aria-label="开始日期" type="date" value={startInput} onChange={(event) => setStartInput(event.target.value)} disabled={dateSaving} /><DateCalendar label="开始日期" value={startInput} month={startMonth} onMonthChange={setStartMonth} onChange={setStartInput} max={endInput || undefined} /></div><div><strong className="date-calendar-label">结束日期</strong><input className="date-calendar-input" aria-label="结束日期" type="date" value={endInput} onChange={(event) => setEndInput(event.target.value)} disabled={dateSaving} /><DateCalendar label="结束日期" value={endInput} month={endMonth} onMonthChange={setEndMonth} onChange={setEndInput} min={startInput || undefined} /></div></div><div className="task-date-editor-actions"><button type="button" className="secondary" onClick={() => setDateEditorOpen(false)} disabled={dateSaving}>取消</button><button type="submit" className="primary" disabled={dateSaving}>保存</button></div></form>}</div><button type="button" className="task-row-menu-trigger" aria-label={`任务操作 ${item.title}`} title="任务操作" onClick={(event) => { event.stopPropagation(); onSelect(item); onMenuOpen(event.currentTarget); }} onDoubleClick={(event) => event.stopPropagation()}>⋯</button></div>;
}

function TaskSummary({ item, events }: { item: WorkItem; events: Array<{ action: string; payload: Record<string, unknown>; createdAt: string }> }) {
  const report = [...events].reverse().find((event) => event.action === 'report');
  const acceptance = [...events].reverse().find((event) => event.action === 'acceptance');
  const reportPayload = report?.payload as { acceptanceCycle?: number; summary?: string; changedFiles?: string[]; tests?: Array<{ command: string; result: string }>; commit?: string | null } | undefined;
  const acceptancePayload = acceptance?.payload as { decision?: string; comment?: string } | undefined;
  const riskCount = item.riskFlags?.length ?? 0;
  return <div className="task-summary task-overview"><section className="task-overview-metrics" aria-label="任务概览指标"><div className="task-overview-metric metric-progress"><span>执行进度</span><strong>{progressLabel(item)}</strong><small>{statusLabel(item.status)}</small></div><div className="task-overview-metric"><span>预估工时</span><strong>{item.estimate ? `${item.estimate} 天` : '未设置'}</strong><small>计划投入</small></div><div className="task-overview-metric"><span>截止日期</span><strong>{item.dueDate ? formatDate(item.dueDate) : '未设置'}</strong><small>计划节点</small></div><div className={`task-overview-metric ${riskCount ? 'metric-risk' : 'metric-normal'}`}><span>风险</span><strong>{riskCount ? `${riskCount} 项` : '正常'}</strong><small>{riskCount ? (item.riskFlags ?? []).map(riskLabel).join(' · ') : '暂无风险预警'}</small></div></section><div className="task-overview-sections"><section className="task-overview-section detail-description"><div className="task-overview-section-heading"><span className="eyebrow">任务说明</span><h4>描述</h4></div><p>{item.description || '暂无描述。'}</p>{reportPayload && <div className="task-report"><h4>{(reportPayload.acceptanceCycle ?? 1) !== (item.acceptanceCycle ?? 1) ? '历史交付报告' : '执行报告'}</h4><p>{reportPayload.summary}</p>{reportPayload.changedFiles?.length ? <div className="task-report-files" aria-label="改动文件"><strong>改动文件</strong>{reportPayload.changedFiles.map((file) => <code key={file}>{file}</code>)}</div> : null}{reportPayload.tests?.map((test) => <small key={test.command}>{test.command}：{test.result}</small>)}{reportPayload.commit && <small>Commit：{reportPayload.commit}</small>}</div>}{acceptancePayload && <div className={`task-acceptance-record ${acceptancePayload.decision}`}><h4>验收记录</h4><p>{acceptancePayload.decision === 'approved' ? '已通过验收' : '验收未通过'}</p>{acceptancePayload.comment && <small>{acceptancePayload.comment}</small>}</div>}</section></div></div>;
}

function AcceptanceItemRow({ item, acceptanceItem, members, canReview, onSave }: { item: WorkItem; acceptanceItem: AcceptanceItem; members: TeamMember[]; canReview: boolean; onSave: (item: WorkItem, acceptanceItem: AcceptanceItem, review: { status: AcceptanceItemStatus; comment: string; evidence: Array<{ label: string; url: string }> }) => void }) {
  const [status, setStatus] = useState<AcceptanceItemStatus>(acceptanceItem.status);
  const [comment, setComment] = useState(acceptanceItem.comment);
  const [evidenceUrl, setEvidenceUrl] = useState(acceptanceItem.evidence[0]?.url ?? '');
  const [evidenceLabel, setEvidenceLabel] = useState(acceptanceItem.evidence[0]?.label ?? '证据链接');
  useEffect(() => { setStatus(acceptanceItem.status); setComment(acceptanceItem.comment); setEvidenceUrl(acceptanceItem.evidence[0]?.url ?? ''); setEvidenceLabel(acceptanceItem.evidence[0]?.label ?? '证据链接'); }, [acceptanceItem]);
  const reviewer = members.find((member) => member.userId === acceptanceItem.reviewedBy);
  const statusOptions: Array<{ value: AcceptanceItemStatus; label: string }> = [
    { value: 'unverified', label: '未验证' },
    { value: 'passed', label: '通过' },
    { value: 'failed', label: '不通过' },
    { value: 'needs_info', label: '待补充' },
  ];
  return <section className={`acceptance-item status-${status}`}><div className="acceptance-item-heading"><strong>{acceptanceItem.text}</strong>{acceptanceItem.required && <span>必验</span>}</div><fieldset disabled={!canReview} className="acceptance-item-controls"><div className="acceptance-status-tabs" role="tablist" aria-label={`验收状态 ${acceptanceItem.text}`}>{statusOptions.map((option) => <button key={option.value} type="button" role="tab" aria-selected={status === option.value} className={`acceptance-status-tab status-${option.value}${status === option.value ? ' active' : ''}`} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div><label><span className="sr-only">验收评论 {acceptanceItem.text}</span><input aria-label={`验收评论 ${acceptanceItem.text}`} value={comment} placeholder="验收结论或问题" onChange={(event) => setComment(event.target.value)} /></label><label><span className="sr-only">证据链接 {acceptanceItem.text}</span><input aria-label={`证据链接 ${acceptanceItem.text}`} type="url" value={evidenceUrl} placeholder="https://..." onChange={(event) => setEvidenceUrl(event.target.value)} /></label><button type="button" className="secondary" aria-label={`提交验收项 ${acceptanceItem.text}`} onClick={() => onSave(item, acceptanceItem, { status, comment: comment.trim(), evidence: evidenceUrl.trim() ? [{ label: evidenceLabel.trim() || '证据链接', url: evidenceUrl.trim() }] : [] })}>提交</button></fieldset>{acceptanceItem.reviewedAt && <small className="acceptance-item-meta">{acceptanceStatusLabel(acceptanceItem.status)} · {reviewer ? memberLabel(reviewer) : '已审阅'} · {new Date(acceptanceItem.reviewedAt).toLocaleString('zh-CN')}</small>}{acceptanceItem.evidence.map((evidence) => <span key={evidence.url} className="acceptance-evidence"><EvidenceLink evidence={evidence} /></span>)}</section>;
}

function flattenRows(childrenByParent: Map<string | null, WorkItem[]>, collapsedIds: Set<string>) {
  const rows: TaskRow[] = [];
  function visit(parentId: string | null, depth: number) { for (const item of childrenByParent.get(parentId) ?? []) { const childCount = childrenByParent.get(item.id)?.length ?? 0; const hasChildren = childCount > 0; const collapsed = collapsedIds.has(item.id); rows.push({ item, depth, hasChildren, childCount, collapsed }); if (!collapsed) visit(item.id, depth + 1); } }
  visit(null, 0);
  return rows;
}

function filterWorkItems(items: WorkItem[], filters: { searchQuery: string; priority: string; status: string; type: string; risk: string }) {
  const query = filters.searchQuery.trim().toLocaleLowerCase();
  const byId = new Map(items.map((item) => [item.id, item]));
  const visibleIds = new Set(items.filter((item) => {
    const searchable = `${item.title} ${item.description ?? ''}`.toLocaleLowerCase();
    return (!query || searchable.includes(query))
      && (filters.priority === 'all' || item.priority === filters.priority)
      && (filters.status === 'all' || item.status === filters.status)
      && (filters.type === 'all' || item.type === filters.type)
      && (filters.risk === 'all' || (filters.risk === 'normal' ? !(item.riskFlags?.length) : (item.riskFlags ?? []).includes(filters.risk)));
  }).map((item) => item.id));
  for (const id of [...visibleIds]) {
    let parentId = byId.get(id)?.parentId ?? null;
    while (parentId) {
      visibleIds.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return items.filter((item) => visibleIds.has(item.id));
}

function compareWorkItems(left: WorkItem, right: WorkItem, sortBy: TaskSort) {
  if (sortBy === 'priority') return priorityRank(left.priority) - priorityRank(right.priority) || left.title.localeCompare(right.title);
  if (sortBy === 'status') return statusLabel(left.status).localeCompare(statusLabel(right.status)) || left.title.localeCompare(right.title);
  if (sortBy === 'type') return left.type.localeCompare(right.type) || left.title.localeCompare(right.title);
  return getStartTime(left) - getStartTime(right) || left.title.localeCompare(right.title);
}

function priorityRank(priority: string) { return ({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 } as Record<string, number>)[priority] ?? 99; }
function getStartTime(item: WorkItem) { return item.dueDate ? addDays(parseDate(item.dueDate), -(Math.max(1, item.estimate ?? 1) - 1)).getTime() : Number.MAX_SAFE_INTEGER; }

function buildDateRange(items: WorkItem[], minimumDays = 0, padding: { before: number; after: number } = { before: 0, after: 0 }) {
  const schedules = items.filter((item) => item.dueDate).map((item) => {
    const end = parseDate(item.dueDate!);
    const start = addDays(end, -(Math.max(1, item.estimate ?? 1) - 1));
    return { start, end };
  });
  const fallback = startOfDay(new Date());
  const earliest = schedules.length ? new Date(Math.min(...schedules.map(({ start }) => start.getTime()))) : fallback;
  const latest = schedules.length ? new Date(Math.max(...schedules.map(({ end }) => end.getTime()))) : fallback;
  const start = addDays(earliest, -7 - padding.before);
  const baseEnd = addDays(latest, 7 + padding.after);
  const end = addDays(baseEnd, Math.max(0, minimumDays - (dayDiff(start, baseEnd) + 1)));
  return Array.from({ length: dayDiff(start, end) + 1 }, (_, index) => addDays(start, index));
}

function parseDate(value: string) { return startOfDay(new Date(`${value}T00:00:00`)); }
function startOfDay(value: Date) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
function addDays(value: Date, amount: number) { const date = new Date(value); date.setDate(date.getDate() + amount); return date; }
function dayDiff(start: Date, end: Date) { return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000); }
function formatMonth(value: Date) { return `${value.getFullYear()}年${value.getMonth() + 1}月`; }
function weekday(value: Date) { return ['日', '一', '二', '三', '四', '五', '六'][value.getDay()]; }
function formatGanttCalendarDate(value: Date) { return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 星期${weekday(value)}`; }
function formatDate(value: string) { return formatDateValue(parseDate(value)); }
function riskLabel(flag: string) { return ({ overdue: '已逾期', due_soon: '即将逾期', blocked: '依赖阻塞', stale: '长期未更新', behind_schedule: '进度落后' } as Record<string, string>)[flag] ?? flag; }
function formatDateValue(value: Date) { return `${value.getMonth() + 1}月${value.getDate()}日`; }
function formatISODate(value: Date) { return `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, '0')}-${`${value.getDate()}`.padStart(2, '0')}`; }
function createVibeTaskPrompt(item: WorkItem) {
  return [
    '请在当前代码仓库中完成以下 Vibe Plan 任务。请先从 Vibe Plan 获取该任务的完整信息（包括描述、验收标准、依赖和执行上下文），再阅读相关代码和现有模式，实施、验证并说明改动。',
    '',
    `任务：${item.title}`,
    `任务 ID：${item.id}`,
    '',
    '执行要求：',
    '1. 先定位相关模块和现有测试，保持改动范围聚焦。',
    '2. 实现后运行相关测试与构建；若失败，说明原因和剩余问题。',
    '3. 输出改动文件、验证结果和需要人工确认的事项。',
  ].join('\n');
}
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy unavailable');
}
function memberLabel(member: TeamMember) { return member.displayName?.trim() || '未填写姓名'; }
function progressLabel(item: WorkItem) { return `${item.progress ?? (item.status === 'done' ? 100 : 0)}%`; }
function progressValue(item: WorkItem) { return Math.min(100, Math.max(0, item.progress ?? (item.status === 'done' ? 100 : 0))); }
function progressBand(item: WorkItem) { const progress = progressValue(item); return progress < 25 ? 'low' : progress < 50 ? 'mid' : progress < 75 ? 'high' : 'complete'; }
function buildContributionStats(items: WorkItem[], members: TeamMember[], events: WorkItemEvent[]) {
  type MemberStats = { userId: string; displayName: string; taskIds: Set<string>; completedTasks: number; progressTotal: number; progressCount: number; contributionDays: number; actualHours: number };
  const stats = new Map<string, MemberStats>();
  for (const member of members) stats.set(member.userId, { userId: member.userId, displayName: memberLabel(member), taskIds: new Set(), completedTasks: 0, progressTotal: 0, progressCount: 0, contributionDays: 0, actualHours: 0 });
  const eventsByTask = new Map<string, WorkItemEvent[]>();
  for (const event of events) {
    if (!event.workItemId) continue;
    eventsByTask.set(event.workItemId, [...(eventsByTask.get(event.workItemId) ?? []), event]);
  }
  for (const taskEvents of eventsByTask.values()) taskEvents.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  function addSegment(item: WorkItem, assigneeId: string | null, fromProgress: number, toProgress: number) {
    if (!assigneeId) return;
    const member = stats.get(assigneeId);
    if (!member) return;
    const from = Math.min(100, Math.max(0, fromProgress));
    const to = Math.min(100, Math.max(from, toProgress));
    member.taskIds.add(item.id);
    member.progressTotal += to - from;
    member.progressCount += 1;
    member.contributionDays += Math.max(0, item.estimate ?? 0) * (to - from) / 100;
  }

  for (const item of items) {
    const taskEvents = eventsByTask.get(item.id) ?? [];
    let assigneeId: string | null = null;
    let segmentStart = 0;
    let hasHistory = false;
    for (const event of taskEvents) {
      const payload = event.payload ?? {};
      const eventProgress = numberValue(payload.resultProgress ?? payload.progress, payload.status === 'done' ? 100 : segmentStart);
      if (event.action === 'created') {
        hasHistory = true;
        assigneeId = nullableId(payload.assigneeId);
        const initialProgress = numberValue(payload.progress, 0);
        addSegment(item, assigneeId, 0, initialProgress);
        segmentStart = initialProgress;
        continue;
      }
      if (event.action !== 'updated') continue;
      const hasAssignmentChange = payload.previousAssigneeId !== undefined || payload.newAssigneeId !== undefined;
      if (hasAssignmentChange) {
        const handoffProgress = numberValue(payload.handoffProgress, eventProgress);
        addSegment(item, assigneeId, segmentStart, handoffProgress);
        assigneeId = nullableId(payload.newAssigneeId);
        segmentStart = handoffProgress;
        hasHistory = true;
      } else if (payload.assigneeId !== undefined && nullableId(payload.assigneeId) !== assigneeId) {
        addSegment(item, assigneeId, segmentStart, eventProgress);
        assigneeId = nullableId(payload.assigneeId);
        segmentStart = eventProgress;
        hasHistory = true;
      }
    }
    const finalProgress = progressValue(item);
    if (hasHistory) {
      addSegment(item, assigneeId, segmentStart, finalProgress);
      if (item.status === 'done' && assigneeId && stats.has(assigneeId)) stats.get(assigneeId)!.completedTasks += 1;
    } else if (item.assigneeId) {
      addSegment(item, item.assigneeId, 0, finalProgress);
      if (item.status === 'done' && stats.has(item.assigneeId)) stats.get(item.assigneeId)!.completedTasks += 1;
    }
  }
  return [...stats.values()].map((member) => ({ ...member, assignedTasks: member.taskIds.size, averageProgress: member.progressCount ? Math.round(member.progressTotal / member.progressCount) : 0 })).sort((left, right) => right.contributionDays - left.contributionDays || right.averageProgress - left.averageProgress || left.displayName.localeCompare(right.displayName));
}
function nullableId(value: unknown): string | null { return typeof value === 'string' && value ? value : null; }
function numberValue(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function formatContributionDays(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
function typeLabel(type: string) { return ({ feature: '功能开发', bug: '缺陷修复', improvement: '改进', refactor: '重构', documentation: '文档', research: '调研', chore: '维护' } as Record<string, string>)[type] ?? type; }
function statusLabel(status: string) { return ({ backlog: '待规划', ready: '待开始', in_progress: '进行中', blocked: '已阻塞', in_review: '待审核', done: '已完成', cancelled: '已取消' } as Record<string, string>)[status] ?? status; }
function acceptanceStatusLabel(status: AcceptanceItemStatus) { return ({ unverified: '未验证', passed: '通过', failed: '不通过', needs_info: '待补充' } as Record<AcceptanceItemStatus, string>)[status]; }
function metaClass(value: string) { return value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'); }
function sameIds(left: string[], right: string[]) { return left.length === right.length && left.every((id, index) => id === right[index]); }
function clampTaskDirectoryWidth(value: number) { return Math.min(720, Math.max(360, value)); }
function formatInputDate(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function readTaskDirectoryWidth() {
  if (typeof window === 'undefined') return 460;
  const stored = window.localStorage.getItem('vibe-plan.task-directory-width');
  if (!stored) return 460;
  const value = Number(stored);
  return Number.isFinite(value) ? clampTaskDirectoryWidth(value) : 460;
}

function readProjectDirectoryCollapsed() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('vibe-plan.project-directory-collapsed') === 'true';
}
