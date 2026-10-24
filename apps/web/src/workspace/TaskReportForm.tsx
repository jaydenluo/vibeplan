import { useEffect, useState } from 'react';
import { apiBase, apiRequest, showMessage } from '../api/client.js';

type Task = { id: string; version?: number; acceptanceItems?: { id: string; text: string }[] };
type Evidence = { label: string; url: string };
type TestResult = { command: string; result: string; outcome: 'passed' | 'failed' | 'skipped' | 'not_run'; exitCode?: number };
type Draft = { summary: string; outcome: 'success' | 'failed' | 'blocked'; changedFiles: string; tests: TestResult[]; evidence: Evidence[]; risks: string; remainingIssues: string; criterionResults: Record<string, { result: string; url: string }> };
const emptyDraft = (): Draft => ({ summary: '', outcome: 'success', changedFiles: '', tests: [], evidence: [], risks: '', remainingIssues: '', criterionResults: {} });
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
export function isHttpEvidence(url: string) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol); } catch { return false; }
}

export function TaskReportForm<T extends Task>({ item, accountId, onUpdated }: { item: T; accountId: string; onUpdated: (item: T) => void }) {
  const draftKey = `vibe-plan.report:${encodeURIComponent(apiBase)}:${encodeURIComponent(accountId)}:${encodeURIComponent(item.id)}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try { const saved = sessionStorage.getItem(draftKey); return saved ? { ...emptyDraft(), ...JSON.parse(saved) } : emptyDraft(); } catch { return emptyDraft(); }
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Storage can be disabled; retain the draft in memory. */ } }, [draft, draftKey]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function submit() {
    const reject = (message: string) => showMessage(message, 'error');
    if (!draft.summary.trim()) { reject('请填写执行说明。'); return; }
    if (!item.version) { reject('任务版本缺失，请刷新后重试。'); return; }
    const evidence = draft.evidence.filter((entry) => entry.url.trim() || entry.label.trim()).map((entry) => ({ label: entry.label.trim() || '证据链接', url: entry.url.trim() }));
    const criterionResults = (item.acceptanceItems ?? []).flatMap((criterion) => {
      const result = draft.criterionResults[criterion.id];
      return result?.result.trim() ? [{ acceptanceItemId: criterion.id, result: result.result.trim(), evidence: result.url.trim() ? [{ label: criterion.text, url: result.url.trim() }] : [] }] : [];
    });
    if ([...evidence, ...criterionResults.flatMap((entry) => entry.evidence)].some((entry) => !isHttpEvidence(entry.url))) { reject('证据链接必须使用 HTTP 或 HTTPS。'); return; }
    if (draft.tests.some((test) => !test.command.trim() || !test.result.trim())) { reject('请填写每项测试的命令与实际结果。'); return; }
    setBusy(true);
    try {
      const updated = await apiRequest<T>(`/work-items/${item.id}/report`, { method: 'POST', body: JSON.stringify({ version: item.version, summary: draft.summary.trim(), outcome: draft.outcome, changedFiles: lines(draft.changedFiles), tests: draft.tests, evidence, risks: lines(draft.risks), remainingIssues: lines(draft.remainingIssues), criterionResults }) });
      try { sessionStorage.removeItem(draftKey); } catch { /* Keep in-memory reset available. */ }
      setDraft(emptyDraft());
      onUpdated(updated);
    } catch { /* The request client has shown the failure; retain the local draft. */ }
    finally { setBusy(false); }
  }
  return <div className="task-report-form">
    <fieldset disabled={busy}><label>执行说明<textarea aria-label="执行说明" value={draft.summary} onChange={(event) => update('summary', event.target.value)} /></label>
      <label>执行结果<select aria-label="执行结果" value={draft.outcome} onChange={(event) => update('outcome', event.target.value as Draft['outcome'])}><option value="success">成功，提交验收</option><option value="failed">失败，继续执行</option><option value="blocked">受阻，等待处理</option></select></label>
      <label>改动文件（每行一个）<textarea aria-label="改动文件" value={draft.changedFiles} onChange={(event) => update('changedFiles', event.target.value)} /></label>
      <h5>测试记录</h5>{draft.tests.map((test, index) => <div className="report-entry" key={index}>
        <input aria-label={`测试命令 ${index + 1}`} placeholder="实际执行的命令" value={test.command} onChange={(event) => update('tests', draft.tests.map((entry, i) => i === index ? { ...entry, command: event.target.value } : entry))} />
        <input aria-label={`测试结果 ${index + 1}`} placeholder="实际结果" value={test.result} onChange={(event) => update('tests', draft.tests.map((entry, i) => i === index ? { ...entry, result: event.target.value } : entry))} />
        <select aria-label={`测试状态 ${index + 1}`} value={test.outcome} onChange={(event) => update('tests', draft.tests.map((entry, i) => i === index ? { ...entry, outcome: event.target.value as TestResult['outcome'] } : entry))}><option value="not_run">未执行</option><option value="passed">通过</option><option value="failed">失败</option><option value="skipped">跳过</option></select>
        <input type="number" step="1" aria-label={`退出码 ${index + 1}`} placeholder="退出码（可选）" value={test.exitCode ?? ''} onChange={(event) => update('tests', draft.tests.map((entry, i) => i === index ? { ...entry, exitCode: event.target.value === '' ? undefined : Number(event.target.value) } : entry))} />
        <button type="button" className="secondary" aria-label={`移除测试 ${index + 1}`} onClick={() => update('tests', draft.tests.filter((_, i) => i !== index))}>移除</button>
      </div>)}<button className="secondary" type="button" onClick={() => update('tests', [...draft.tests, { command: '', result: '', outcome: 'not_run' }])}>添加测试</button>
      <h5>交付证据</h5>{draft.evidence.map((entry, index) => <div className="report-entry" key={index}><input aria-label={`证据名称 ${index + 1}`} placeholder="证据名称" value={entry.label} onChange={(event) => update('evidence', draft.evidence.map((value, i) => i === index ? { ...value, label: event.target.value } : value))} /><input aria-label={`证据链接 ${index + 1}`} placeholder="https://..." value={entry.url} onChange={(event) => update('evidence', draft.evidence.map((value, i) => i === index ? { ...value, url: event.target.value } : value))} /><button type="button" className="secondary" aria-label={`移除证据 ${index + 1}`} onClick={() => update('evidence', draft.evidence.filter((_, i) => i !== index))}>移除</button></div>)}<button className="secondary" type="button" onClick={() => update('evidence', [...draft.evidence, { label: '', url: '' }])}>添加证据</button>
      {(item.acceptanceItems ?? []).map((criterion) => <div key={criterion.id}><label>验收结果：{criterion.text}<textarea aria-label={`验收结果 ${criterion.text}`} value={draft.criterionResults[criterion.id]?.result ?? ''} onChange={(event) => update('criterionResults', { ...draft.criterionResults, [criterion.id]: { url: draft.criterionResults[criterion.id]?.url ?? '', result: event.target.value } })} /></label><input aria-label={`验收证据 ${criterion.text}`} placeholder="https://...（可选）" value={draft.criterionResults[criterion.id]?.url ?? ''} onChange={(event) => update('criterionResults', { ...draft.criterionResults, [criterion.id]: { result: draft.criterionResults[criterion.id]?.result ?? '', url: event.target.value } })} /></div>)}
      <small>执行结果是交付证据，验收通过由审核人确认。</small>
      <label>已知风险（每行一个）<textarea aria-label="已知风险" value={draft.risks} onChange={(event) => update('risks', event.target.value)} /></label><label>剩余事项（每行一个）<textarea aria-label="剩余事项" value={draft.remainingIssues} onChange={(event) => update('remainingIssues', event.target.value)} /></label>
      <button className="secondary" type="button" onClick={() => void submit()}>提交执行报告</button>
    </fieldset>
  </div>;
}
