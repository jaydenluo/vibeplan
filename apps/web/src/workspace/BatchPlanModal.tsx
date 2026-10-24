import { useEffect, useMemo, useRef, useState } from 'react';
import { showMessage } from '../api/client.js';

type Task = { id: string; title: string; status: string; parentId?: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

export function BatchPlanModal({ projectName, items, onClose }: { projectName: string; items: Task[]; onClose: () => void }) {
  const tasks = useMemo(() => {
    const parents = new Set(items.map((item) => item.parentId).filter(Boolean));
    return items.filter((item) => !parents.has(item.id) && ['backlog', 'ready', 'in_progress', 'blocked'].includes(item.status));
  }, [items]);
  const [selected, setSelected] = useState(() => new Set(tasks.map((item) => item.id)));
  const [check, setCheck] = useState('');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', listener);
    return () => { document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);
  const ids = tasks.filter((task) => selected.has(task.id)).map((task) => task.id);
  let validation = '';
  let checkArg = '';
  if (ids.some((id) => !uuid.test(id))) validation = '任务 ID 无效，请刷新项目任务。';
  if (check.trim()) {
    try {
      const argv: unknown = JSON.parse(check);
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== 'string' || !arg.trim() || arg.includes('\0'))) throw new Error();
      checkArg = shellQuote(JSON.stringify(argv));
    } catch { validation = '请输入由非空字符串组成的 JSON 参数数组。'; }
  }
  const command = ids.length && checkArg && !validation ? `vibeplan plan:prepare ${ids.map((id) => `--task ${id}`).join(' ')} --check ${checkArg}` : '';
  async function copy() {
    if (validation) { showMessage(validation, 'error'); return; }
    try { await navigator.clipboard.writeText(command); showMessage('准备命令已复制'); }
    catch { showMessage('复制失败，请手动选择并复制下方命令。', 'error'); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="modal-panel batch-plan-modal" role="dialog" aria-modal="true" aria-labelledby="batch-plan-title">
      <div className="modal-heading"><div><p className="eyebrow">{projectName}</p><h3 id="batch-plan-title">执行计划</h3></div><button type="button" className="close-button" aria-label="关闭" onClick={onClose}>×</button></div>
      <p className="modal-help">选择本次范围，在已绑定此项目的本地仓库运行准备命令。已完成、取消和待验收任务不列入本次实施。CLI 从云端读取最新任务并生成快照；浏览器不能在你的电脑上执行代码。</p>
      <fieldset className="batch-plan-tasks"><legend>未完成的叶子任务（已选 {ids.length} 项）</legend>{tasks.length ? tasks.map((task) => <label key={task.id}><input type="checkbox" checked={selected.has(task.id)} onChange={() => { setSelected((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; }); }} />{task.title}</label>) : <p>暂无可执行的叶子任务。</p>}</fieldset>
      <div className="modal-form"><label>项目测试命令（JSON 参数数组）<input value={check} placeholder={'例如 ["npm","test"]，请填写项目实际命令'} onChange={(event) => setCheck(event.target.value)} /></label></div>
      <p className="modal-help">参数直接传给程序，不按 shell 脚本执行。使用项目已安装的工具和真实测试命令。</p>
      <pre className="batch-plan-command" aria-label="准备命令">{command || '选择任务并填写有效测试命令后生成命令。'}</pre>
      <button type="button" className="primary" disabled={!ids.length || !check.trim() || ids.some((id) => !uuid.test(id))} onClick={() => void copy()}>复制准备命令</button>
      <p className="modal-help">检查生成的 .vibe/batch-plan.json，按任务配置 checks 并填写整体验证 integrationChecks。确认范围后在本地运行：</p>
      <pre className="batch-plan-command">vibeplan plan:run --file .vibe/batch-plan.json --approve</pre>
      <p className="modal-help">默认保留人工验收；后续依赖等待前置任务验收通过。仅明确授权自动验收且账号有审核权限时添加 --auto-accept，所有测试及独立复核通过才会验收。整体集成结果独立记录。</p>
      <p className="modal-help">查看进度：vibeplan plan:status --file .vibe/batch-plan.json。中断后先核对记录，再用 --resume 显式恢复；范围变化需用 --file 新路径准备并重新授权，已有清单不会覆盖。整体验证失败时，批次仍失败。</p>
    </section>
  </div>;
}
