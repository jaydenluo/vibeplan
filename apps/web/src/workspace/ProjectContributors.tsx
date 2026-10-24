import { useEffect, useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';
import { ContributorBreakdown, type Contributor } from './ContributorBreakdown.js';

export function ProjectContributors({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState('');
  const [contributors, setContributors] = useState<Contributor[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setContributors(null); setLoadFailed(false);
    apiRequest<{ members: Contributor[] }>(`/projects/${projectId}/contributors${range}`).then((result) => { if (active) setContributors(Array.isArray(result.members) ? result.members : []); }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [projectId, range]);
  function applyRange() {
    if (from && to && from > to) { showMessage('开始日期不能晚于结束日期。', 'error'); return; }
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    setRange(query.size ? `?${query}` : '');
  }
  return <section><div className="contribution-range"><label>开始日期<input type="date" aria-label="贡献开始日期" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>结束日期<input type="date" aria-label="贡献结束日期" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary" type="button" onClick={applyRange}>应用日期范围</button></div><p className="modal-help">日期范围包含首尾日期；工时按工作日期，报告、测试与验收记录按 UTC 日期统计。范围仅筛选实际记录。</p>{contributors === null ? <p className="modal-help">{loadFailed ? '暂时没有可显示的协作贡献数据。' : '正在加载协作贡献…'}</p> : <ContributorBreakdown contributors={contributors} />}</section>;
}
