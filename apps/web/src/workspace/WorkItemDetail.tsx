import type { WorkItem } from './WorkItemBoard.js';

export function WorkItemDetail({ item, onClose }: { item: WorkItem | null; onClose: () => void }) {
  if (!item) return null;
  return (
    <aside className="detail-panel" aria-label="任务详情">
      <button className="close-button" onClick={onClose} aria-label="关闭任务详情">×</button>
      <span className={`priority ${item.priority.toLowerCase()}`}>{item.priority}</span>
      <h2>{item.title}</h2>
      <dl>
        <dt>类型</dt><dd>{item.type}</dd>
        <dt>状态</dt><dd>{item.status}</dd>
        <dt>负责人</dt><dd>{item.assigneeId ?? '未分配'}</dd>
      </dl>
    </aside>
  );
}
