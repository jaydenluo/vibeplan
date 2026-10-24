import { useRef, useState } from 'react';

export type WorkItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  progress?: number | null;
  assigneeId?: string | null;
  parentId?: string | null;
  dependsOn?: string[];
  version?: number;
};

const columns = [
  ['backlog', '待规划'],
  ['ready', '待开始'],
  ['in_progress', '进行中'],
  ['in_review', '待审核'],
  ['done', '已完成'],
] as const;

export function WorkItemBoard({ items, onSelect, onMove }: { items: WorkItem[]; onSelect: (item: WorkItem) => void; onMove?: (item: WorkItem, status: string) => void }) {
  const draggedItemRef = useRef<WorkItem | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  function startDrag(item: WorkItem, event: React.DragEvent<HTMLButtonElement>) {
    draggedItemRef.current = item;
    setDraggedId(item.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.id);
    }
  }
  function drop(status: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const item = draggedItemRef.current;
    if (item && item.status !== status) onMove?.(item, status);
    draggedItemRef.current = null;
    setDraggedId(null);
  }
  function endDrag() { draggedItemRef.current = null; setDraggedId(null); }
  return (
    <section className="board" aria-label="任务看板">
      {columns.map(([status, label]) => (
        <div className="column" key={status} role="region" aria-label={label} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(status, event)}>
          <div className="column-title"><span>{label}</span><span className="count">{items.filter((item) => item.status === status).length}</span></div>
          <div className="column-items">
            {items.filter((item) => item.status === status).map((item) => (
              <button className={`work-item${draggedId === item.id ? ' dragging' : ''}`} key={item.id} draggable onDragStart={(event) => startDrag(item, event)} onDragEnd={endDrag} onClick={() => onSelect(item)}>
                <span className={`priority ${item.priority.toLowerCase()}`}>{item.priority}</span>
                <strong>{item.title}</strong>
                <small>{item.type} · {item.progress ?? (item.status === 'done' ? 100 : 0)}%</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
