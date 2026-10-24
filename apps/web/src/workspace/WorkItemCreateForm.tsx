import { useState } from 'react';
import { apiRequest } from '../api/client.js';

type WorkItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  estimate?: number | null;
  progress?: number | null;
  planMarkdown?: string | null;
  actualHours?: number | string | null;
  description?: string;
  acceptanceCriteria?: string[];
  version?: number;
};

type Props = {
  projectId: string;
  parentId?: string | null;
  parentTitle?: string;
  item?: WorkItem | null;
  onCreated?: (createdId?: string) => void;
  onUpdated?: (item: WorkItem) => void;
  onCancel: () => void;
};

export function WorkItemCreateForm({ projectId, parentId = null, parentTitle, item, onCreated, onUpdated, onCancel }: Props) {
  const editing = Boolean(item);
  const [title, setTitle] = useState(item?.title ?? '');
  const [type, setType] = useState(item?.type ?? 'feature');
  const [status, setStatus] = useState(item?.status ?? 'backlog');
  const [priority, setPriority] = useState(item?.priority ?? 'P2');
  const [dueDate, setDueDate] = useState(item?.dueDate ?? '');
  const [estimate, setEstimate] = useState(String(item?.estimate ?? 1));
  const [progress, setProgress] = useState(String(item?.progress ?? 0));
  const [description, setDescription] = useState(item?.description ?? '');
  const [planMarkdown, setPlanMarkdown] = useState(item?.planMarkdown ?? '');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(item?.acceptanceCriteria?.length ? item.acceptanceCriteria : ['']);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const payload = { title, type, status, priority, dueDate: dueDate || null, estimate: Number(estimate), progress: Number(progress), description: description.trim(), acceptanceCriteria: acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean), ...(planMarkdown.trim() ? { planMarkdown: planMarkdown.trim() } : {}) };
      if (item) {
        const updated = await apiRequest<WorkItem>(`/work-items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, version: item.version ?? 1 }),
        });
        onUpdated?.(updated);
      } else {
        const created = await apiRequest<{ id?: string }>(`/projects/${projectId}/work-items`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, ...(parentId ? { parentId } : {}) }),
        });
        onCreated?.(created.id);
      }
    } catch { /* The request client has shown the failure. */ }
  }

  function updateCriterion(index: number, value: string) {
    setAcceptanceCriteria((current) => current.map((criterion, position) => position === index ? value : criterion));
  }

  function removeCriterion(index: number) {
    setAcceptanceCriteria((current) => current.length === 1 ? current : current.filter((_, position) => position !== index));
  }

  return (
    <form className="work-item-form" onSubmit={submit}>
      <div className="form-heading"><div><h2>{editing ? '编辑任务' : parentId ? '新建子任务' : '新建任务'}</h2>{parentTitle && <p className="form-parent-note">父任务：{parentTitle}</p>}</div><button type="button" className="close-button" onClick={onCancel} aria-label={editing ? '关闭编辑任务' : '关闭新建任务'}>×</button></div>
      <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={240} /></label>
      <div className="form-grid">
        <label>类型<select value={type} onChange={(event) => setType(event.target.value)}><option value="feature">功能开发</option><option value="bug">缺陷修复</option><option value="improvement">改进</option><option value="refactor">重构</option><option value="documentation">文档</option><option value="research">调研</option><option value="chore">维护</option></select></label>
        <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="backlog">待规划</option><option value="ready">待开始</option><option value="in_progress">进行中</option><option value="blocked">已阻塞</option><option value="in_review">待审核</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></label>
        <label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label>
        <label>计划结束日期<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label>预估工时（天）<input type="number" min="1" step="1" value={estimate} onChange={(event) => setEstimate(event.target.value)} required /></label>
        <label>完成度（%）<input type="number" min="0" max="100" step="5" value={progress} onChange={(event) => setProgress(event.target.value)} required /></label>
      </div>
      <label>描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></label>
      <label>详细计划 Markdown<textarea value={planMarkdown} onChange={(event) => setPlanMarkdown(event.target.value)} rows={7} placeholder="# 目标\n\n## 实施步骤\n\n## 测试方案" /></label>
      <fieldset className="acceptance-criteria"><legend>验收标准</legend>{acceptanceCriteria.map((criterion, index) => <div className="criterion-row" key={index}><input aria-label={`验收标准 ${index + 1}`} value={criterion} onChange={(event) => updateCriterion(index, event.target.value)} /><button type="button" aria-label={`删除验收标准 ${index + 1}`} title="删除验收标准" onClick={() => removeCriterion(index)} disabled={acceptanceCriteria.length === 1}>×</button></div>)}<button type="button" className="add-criterion" aria-label="新增验收标准" title="新增验收标准" onClick={() => setAcceptanceCriteria((current) => [...current, ''])}>＋</button></fieldset>
      <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>取消</button><button type="submit" className="primary">{editing ? '保存修改' : '创建任务'}</button></div>
    </form>
  );
}
