import { useEffect, useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';
import { TaskReportForm } from './TaskReportForm.js';

type Task = { id: string; status: string; version?: number; acceptanceItems?: { id: string; text: string }[] };
type Mode = 'acceptance' | 'execution';
export function TaskAcceptanceActions<T extends Task>({ item, onUpdated, mode = 'acceptance' }: { item: T; onUpdated: (item: T) => void; mode?: Mode }) {
  const [permissions, setPermissions] = useState({ canReview: false, canContribute: false });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPermissions({ canReview: false, canContribute: false });
    setAccountId(null); setComment('');
    apiRequest<typeof permissions>(`/work-items/${item.id}/permissions`).then((value) => { if (active) setPermissions(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [item.id]);
  useEffect(() => {
    if (mode !== 'execution' || !permissions.canContribute || !['in_progress', 'blocked'].includes(item.status)) return;
    let active = true;
    apiRequest<{ id: string }>('/auth/me').then((user) => { if (active) setAccountId(user.id); }).catch(() => undefined);
    return () => { active = false; };
  }, [permissions.canContribute, item.id, item.status]);

  async function submit(decision?: 'approved' | 'rejected') {
    if (decision === 'rejected' && !comment.trim()) { showMessage('请填写退回原因。', 'error'); return; }
    if (!item.version) { showMessage('任务版本缺失，请刷新后重试。', 'error'); return; }
    setBusy(true);
    try {
      const updated = await apiRequest<T>(`/work-items/${item.id}/${decision ? 'accept' : 'report'}`, {
        method: 'POST',
        body: JSON.stringify({ version: item.version, decision, comment: comment.trim() }),
      });
      onUpdated(updated);
      setComment('');
    } catch { /* The request client has shown the failure. */ }
    finally { setBusy(false); }
  }

  if (mode === 'execution') return <section className="task-support-panel task-execution-actions"><h4>提交执行报告</h4>
    {['in_progress', 'blocked'].includes(item.status) && permissions.canContribute && accountId && <TaskReportForm key={`${accountId}:${item.id}`} item={item} accountId={accountId} onUpdated={onUpdated} />}
    {['in_progress', 'blocked'].includes(item.status) && !permissions.canContribute && <p>当前任务为只读，执行成员可提交报告。</p>}
    {item.status === 'in_review' && <p>执行报告已提交，等待验收。</p>}
    {item.status === 'done' && <p>任务已完成验收。</p>}
    {!['in_progress', 'blocked', 'in_review', 'done'].includes(item.status) && <p>任务开始执行后可提交执行报告。</p>}
  </section>;

  return <section className="task-support-panel"><h4>交付与验收</h4>
    {item.status === 'in_review' && (permissions.canReview ? <><label>验收说明 / 退回原因<textarea aria-label="验收说明 / 退回原因" value={comment} onChange={(event) => setComment(event.target.value)} disabled={busy} placeholder="退回时必须说明需要修改的内容" /></label><div className="task-acceptance-actions"><button type="button" className="secondary" disabled={busy} onClick={() => void submit('rejected')}>退回修改</button><button type="button" className="primary" disabled={busy} onClick={() => void submit('approved')}>批准完成</button></div></> : <p>等待有审核权限的成员验收。</p>)}
    {item.status === 'done' && <p>已完成验收。若需更改验收标准或结论，请先重新打开任务。</p>}
    {!['in_progress', 'blocked', 'in_review', 'done'].includes(item.status) && <p>任务开始执行后可提交验收。</p>}
  </section>;
}
