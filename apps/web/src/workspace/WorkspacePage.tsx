import { useCallback, useState } from 'react';
import { WorkItemBoard, type WorkItem } from './WorkItemBoard.js';
import { WorkItemDetail } from './WorkItemDetail.js';
import { useProjectEvents } from './useProjectEvents.js';

const demoItems: WorkItem[] = [
  { id: 'demo-1', title: '连接项目仓库', type: 'chore', status: 'done', priority: 'P1' },
  { id: 'demo-2', title: '创建第一个 Codex 任务', type: 'feature', status: 'in_progress', priority: 'P1' },
  { id: 'demo-3', title: '配置邮箱验证', type: 'feature', status: 'ready', priority: 'P2' },
];

export function WorkspacePage() {
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [items, setItems] = useState(demoItems);
  const refresh = useCallback(() => setItems((current) => [...current]), []);
  useProjectEvents(null, refresh);

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div><span className="eyebrow">ACME / FRONTEND</span><h1>项目计划</h1></div>
        <button className="secondary">同步项目</button>
      </header>
      <nav className="project-tabs"><button className="active">任务看板</button><button>代码关系</button><button>活动记录</button></nav>
      <WorkItemBoard items={items} onSelect={setSelected} />
      <WorkItemDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
