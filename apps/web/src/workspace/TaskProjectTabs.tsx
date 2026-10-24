import { useMemo } from 'react';
import type { WorkItem } from './WorkItemBoard.js';

type Project = { id: string; name: string; repositoryUrl?: string | null };
export type ProjectEvent = { id?: string; workItemId: string; actorId?: string | null; action: string; payload: Record<string, unknown>; createdAt: string; sequence?: number };

const actionLabels: Record<string, string> = { created: '创建任务', updated: '更新任务', deleted: '删除任务', report: '提交执行报告', acceptance: '提交验收', acceptance_item_reviewed: '更新验收项', work_log: '记录工作', dependency_updated: '更新依赖' };

export function TaskCodeRelations({ project, items, onSelect }: { project?: Project; items: WorkItem[]; onSelect: (item: WorkItem) => void }) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const dependencyCount = items.reduce((count, item) => count + (item.dependsOn?.length ?? 0), 0);
  const parentCount = items.filter((item) => item.parentId).length;
  const blockedCount = items.filter((item) => (item.dependsOn ?? []).some((id) => byId.get(id)?.status !== 'done')).length;
  const roots = items.filter((item) => !item.parentId || !byId.has(item.parentId));
  const childrenByParent = useMemo(() => {
    const result = new Map<string, WorkItem[]>();
    items.forEach((item) => { if (item.parentId) result.set(item.parentId, [...(result.get(item.parentId) ?? []), item]); });
    return result;
  }, [items]);
  return <section className="task-project-panel task-code-relations" aria-label="任务关系">
    <div className="task-project-panel-heading"><div><p className="eyebrow">项目结构 · 关系视图</p><h2>任务关系</h2><p>用任务层级和依赖状态理解项目推进路径。</p></div>{project?.repositoryUrl ? <a className="text-action" href={project.repositoryUrl} target="_blank" rel="noreferrer">打开代码仓库 ↗</a> : null}</div>
    <div className="task-relation-metrics"><div><strong>{items.length}</strong><span>任务</span></div><div><strong>{parentCount}</strong><span>子任务</span></div><div><strong>{dependencyCount}</strong><span>依赖关系</span></div><div className={blockedCount ? 'has-risk' : ''}><strong>{blockedCount}</strong><span>当前阻塞</span></div></div>
    {items.length === 0 ? <p className="task-project-empty">暂无任务关系。</p> : <div className="task-relation-layout">
      <section className="task-relation-section task-tree-section" aria-labelledby="task-tree-heading"><div className="task-relation-section-heading"><div><span className="eyebrow">结构导航</span><h3 id="task-tree-heading">父子任务</h3></div><span>{roots.length} 个主任务</span></div><div className="task-tree-list">{roots.map((item) => <TaskRelationTree key={item.id} item={item} depth={0} childrenByParent={childrenByParent} onSelect={onSelect} />)}</div></section>
      <section className="task-relation-section task-dependencies-section" aria-labelledby="task-dependency-heading"><div className="task-relation-section-heading"><div><span className="eyebrow">推进路径</span><h3 id="task-dependency-heading">依赖关系</h3></div><span>{blockedCount ? `${blockedCount} 项阻塞` : '路径畅通'}</span></div>{dependencyCount === 0 ? <p className="task-relation-empty">当前没有配置前置依赖。</p> : <div className="task-dependency-map">{items.filter((item) => item.dependsOn?.length).map((item) => { const dependencies = (item.dependsOn ?? []).map((id) => byId.get(id)).filter((candidate): candidate is WorkItem => Boolean(candidate)); const blocked = dependencies.some((candidate) => candidate.status !== 'done'); return <button type="button" className={`task-dependency-card${blocked ? ' is-blocked' : ''}`} key={item.id} onClick={() => onSelect(item)}><span className="task-dependency-card-title"><strong>{item.title}</strong><small>{blocked ? '等待前置任务完成' : '依赖已满足'}</small></span><span className="task-dependency-arrow" aria-hidden="true">←</span><span className="task-dependency-prerequisites">{dependencies.map((candidate) => <span key={candidate.id}>{candidate.title}<small>{statusLabel(candidate.status)}</small></span>)}</span></button>; })}</div>}</section>
    </div>}
    <section className="task-code-association" aria-label="代码关联"><div><span className="eyebrow">代码连接</span><h3>代码关联</h3><p>{project?.repositoryUrl ? '仓库已配置，提交与任务的自动关联尚未建立。' : '当前项目还没有配置代码仓库地址。'}</p></div>{project?.repositoryUrl ? <span className="task-code-association-state">待接入 Commit</span> : null}<small>接入 Git 提交后，这里将显示关联 Commit、改动文件、分支和提交人。</small></section>
  </section>;
}

function TaskRelationTree({ item, depth, childrenByParent, onSelect }: { item: WorkItem; depth: number; childrenByParent: Map<string, WorkItem[]>; onSelect: (item: WorkItem) => void }) {
  const children = childrenByParent.get(item.id) ?? [];
  return <div className="task-tree-node"><button type="button" className="task-tree-relation-row" style={{ '--task-depth': depth } as React.CSSProperties} onClick={() => onSelect(item)}><span className="task-tree-branch" aria-hidden="true">{depth === 0 ? '◈' : '└'}</span><span className="task-tree-relation-copy"><strong>{item.title}</strong><small>{statusLabel(item.status)} · {item.assigneeId ? '已分配负责人' : '未分配负责人'}</small></span><span className="task-tree-relation-progress">{progressValue(item)}%</span></button>{children.length > 0 && <div className="task-tree-children">{children.map((child) => <TaskRelationTree key={child.id} item={child} depth={depth + 1} childrenByParent={childrenByParent} onSelect={onSelect} />)}</div>}</div>;
}

function progressValue(item: WorkItem) { return item.progress ?? (item.status === 'done' ? 100 : 0); }
function statusLabel(status: string) { return ({ backlog: '待规划', ready: '待开始', in_progress: '进行中', in_review: '待审核', done: '已完成', blocked: '已阻塞', cancelled: '已取消' } as Record<string, string>)[status] ?? status; }

export function TaskActivity({ items, events, loading, error, onSelect }: { items: WorkItem[]; events: ProjectEvent[]; loading: boolean; error: string; onSelect: (item: WorkItem) => void }) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const ordered = [...events].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return <section className="task-project-panel task-activity" aria-label="活动记录"><div className="task-project-panel-heading"><div><p className="eyebrow">项目动态</p><h2>活动记录</h2><p>记录任务创建、进度调整、执行报告和验收变化。</p></div><span className="task-activity-count">{events.length} 条记录</span></div>{loading ? <p className="task-project-empty">正在加载活动记录…</p> : error ? <p className="task-project-empty">暂无可显示的活动记录。</p> : ordered.length === 0 ? <p className="task-project-empty">暂无活动记录。</p> : <ol className="task-activity-list">{ordered.map((event, index) => { const item = byId.get(event.workItemId); return <li key={event.id ?? `${event.createdAt}-${event.workItemId}-${index}`}><button type="button" className="task-activity-row" onClick={() => item && onSelect(item)} disabled={!item}><span className="task-activity-dot" aria-hidden="true" /><span className="task-activity-copy"><strong>{actionLabels[event.action] ?? event.action}</strong><small>{item?.title ?? '任务已删除'} · {event.actorId ?? '系统'} · {new Date(event.createdAt).toLocaleString('zh-CN')}</small></span><span className="task-activity-summary">{eventSummary(event)}</span><span aria-hidden="true">›</span></button></li>; })}</ol>}</section>;
}

function eventSummary(event: ProjectEvent) {
  const payload = event.payload;
  if (typeof payload.summary === 'string' && payload.summary) return payload.summary;
  if (typeof payload.content === 'string' && payload.content) return payload.content;
  if (typeof payload.comment === 'string' && payload.comment) return payload.comment;
  if (payload.changes && typeof payload.changes === 'object') return `更新 ${Object.keys(payload.changes).length} 个字段`;
  return '查看任务详情';
}
