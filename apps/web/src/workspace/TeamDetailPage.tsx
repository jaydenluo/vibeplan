import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { InviteLinkModal } from './InviteLinkModal.js';

type Team = { id: string; name: string; slug: string };
type TeamMember = { userId: string; email: string; displayName?: string | null; role: 'lead' | 'member' };
type TeamDetails = { team: Team; members: TeamMember[]; projectsCount: number; canManage: boolean };

type Props = {
  organizationId: string;
  team: Team;
  onBack: () => void;
  onChanged: () => void;
};

export function TeamDetailPage({ organizationId, team, onBack, onChanged }: Props) {
  const [details, setDetails] = useState<TeamDetails | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmingMemberId, setConfirmingMemberId] = useState<string | null>(null);

  async function load() {
    try {
      setDetails(await apiRequest<TeamDetails>(`/teams/${team.id}/details`));
    } catch { /* The request client has shown the failure. */ }
  }

  useEffect(() => { void load(); }, [team.id]);

  async function updateRole(member: TeamMember, role: TeamMember['role']) {
    if (member.role === role) return;
    try {
      await apiRequest(`/teams/${team.id}/members/${member.userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await load();
      onChanged();
    } catch { /* The request client has shown the failure. */ }
  }

  async function removeMember(member: TeamMember) {
    try {
      await apiRequest(`/teams/${team.id}/members/${member.userId}`, { method: 'DELETE' });
      setConfirmingMemberId(null);
      await load();
      onChanged();
    } catch { /* The request client has shown the failure. */ }
  }

  return <section className="management-page team-detail-page">
    <header className="team-detail-header">
      <button className="back-button" type="button" onClick={onBack}>← <span>返回团队</span></button>
      <div className="team-detail-title"><p className="eyebrow">团队管理</p><h2>{team.name}</h2><span>成员、权限与协作项目</span></div>
      <div className="team-detail-actions">{details?.canManage && <button className="primary" type="button" onClick={() => setInviteOpen(true)}>生成邀请链接</button>}<button className="secondary" type="button" onClick={() => void load()}>刷新</button></div>
    </header>
    {!details ? <div className="empty-state">正在加载团队详情…</div> : <>
      <div className="team-detail-stats"><div><strong>{details.members.length}</strong><span>团队成员</span></div><div><strong>{details.projectsCount}</strong><span>关联项目</span></div><div><strong>{details.canManage ? '可管理' : '只读'}</strong><span>我的权限</span></div></div>
      <section className="team-members-panel" aria-label="团队成员"><div className="team-members-heading"><div><p className="eyebrow">成员与权限</p><h3>团队成员</h3></div><span>{details.members.length} 人</span></div>{details.members.length === 0 ? <p className="muted">暂无团队成员。</p> : <div className="team-member-list">{details.members.map((member) => <div className="team-member-row" key={member.userId}><div className="team-member-identity"><span className="member-avatar">{memberLabel(member).slice(0, 1).toUpperCase()}</span><span><strong>{memberLabel(member)}</strong><small>{member.email}</small></span></div><span className={`role-badge role-${member.role}`}>{roleLabel(member.role)}</span>{details.canManage ? <div className="team-member-actions"> <label className="sr-only">角色 {memberLabel(member)}<select aria-label={`角色 ${memberLabel(member)}`} value={member.role} onChange={(event) => void updateRole(member, event.target.value as TeamMember['role'])}><option value="lead">负责人</option><option value="member">成员</option></select></label>{confirmingMemberId === member.userId ? <><button className="danger-button" type="button" onClick={() => void removeMember(member)}>确认移除</button><button className="quiet-button" type="button" onClick={() => setConfirmingMemberId(null)}>取消</button></> : <button className="quiet-button" type="button" aria-label={`移除 ${memberLabel(member)}`} onClick={() => setConfirmingMemberId(member.userId)}>移除</button>}</div> : null}</div>)}</div>}</section>
      <section className="team-permission-note"><strong>权限说明</strong><span>负责人可以邀请成员、调整角色和移除成员；成员可以查看团队、项目和任务。</span></section>
    </>}
    {inviteOpen && <InviteLinkModal eyebrow="团队成员" title="生成团队邀请链接" description={`对方打开链接并登录后，可以直接加入“${team.name}”，同时加入所在组织。`} path={`/organizations/${organizationId}/invite-links`} payload={{ teamId: team.id }} onClose={() => { setInviteOpen(false); onChanged(); }} />}
  </section>;
}

function memberLabel(member: TeamMember) { return member.displayName?.trim() || member.email; }
function roleLabel(role: TeamMember['role']) { return role === 'lead' ? '负责人' : '成员'; }
