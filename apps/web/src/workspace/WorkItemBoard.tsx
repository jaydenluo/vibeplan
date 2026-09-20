export type WorkItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  assigneeId?: string | null;
};

const columns = [
  ['backlog', '待规划'],
  ['ready', '待开始'],
  ['in_progress', '进行中'],
  ['in_review', '待审核'],
  ['done', '已完成'],
] as const;

export function WorkItemBoard({ items, onSelect }: { items: WorkItem[]; onSelect: (item: WorkItem) => void }) {
  return (
    <section className="board" aria-label="任务看板">
      {columns.map(([status, label]) => (
        <div className="column" key={status}>
          <div className="column-title"><span>{label}</span><span className="count">{items.filter((item) => item.status === status).length}</span></div>
          <div className="column-items">
            {items.filter((item) => item.status === status).map((item) => (
              <button className="work-item" key={item.id} onClick={() => onSelect(item)}>
                <span className={`priority ${item.priority.toLowerCase()}`}>{item.priority}</span>
                <strong>{item.title}</strong>
                <small>{item.type}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
