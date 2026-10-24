import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

type Team = { id: string; name: string };
type Pending = { invitations: Array<{ id: string; organizationName: string; teamName?: string | null }>; joinRequests: Array<{ id: string; teamName: string }> };
type JoinRequest = { id: string; email: string; teamId: string };

export function ApprovalsPage({ teams, onChanged }: { teams: Team[]; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending>({ invitations: [], joinRequests: [] });
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  async function load() {
    const mine = await apiRequest<Pending>('/me/pending');
    const all = (await Promise.all(teams.map((team) => apiRequest<JoinRequest[]>(`/teams/${team.id}/join-requests`).catch(() => [])))).flat();
    setPending(mine); setRequests(all);
  }
  useEffect(() => { void load().catch(() => undefined); }, [teams]);
  async function decide(path: string) { try { await apiRequest(path, { method: 'POST' }); await load(); onChanged(); } catch { /* The request client has shown the failure. */ } }
  async function review(id: string, decision: 'approved' | 'rejected') { try { await apiRequest(`/team-join-requests/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }); await load(); onChanged(); } catch { /* The request client has shown the failure. */ } }
  return <section className="management-page"><div className="page-heading"><div><p className="eyebrow">待处理审批</p><h2>邀请与申请</h2></div><span className="muted">处理组织和团队成员变更</span></div><div className="panel-list"><h3>我的邀请</h3>{pending.invitations.length === 0 ? <p className="muted">没有待处理邀请。</p> : pending.invitations.map((item) => <div className="list-row" key={item.id}><div><strong>{item.organizationName}</strong><small>{item.teamName ?? '组织成员'}</small></div><span><button className="primary compact" onClick={() => void decide(`/invitations/${item.id}/accept`)}>接受</button><button className="secondary compact" onClick={() => void decide(`/invitations/${item.id}/reject`)}>拒绝</button></span></div>)}</div><div className="panel-list"><h3>我的加入申请</h3>{pending.joinRequests.length === 0 ? <p className="muted">没有待处理申请。</p> : pending.joinRequests.map((item) => <div className="list-row" key={item.id}><strong>{item.teamName}</strong><small>等待管理员审批</small></div>)}</div><div className="panel-list"><h3>团队审批</h3>{requests.length === 0 ? <p className="muted">没有待审批申请。</p> : requests.map((item) => <div className="list-row" key={item.id}><div><strong>{item.email}</strong><small>团队申请</small></div><span><button className="primary compact" onClick={() => void review(item.id, 'approved')}>批准</button><button className="secondary compact" onClick={() => void review(item.id, 'rejected')}>拒绝</button></span></div>)}</div></section>;
}
