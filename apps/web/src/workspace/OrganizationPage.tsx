import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { TeamDetailPage } from './TeamDetailPage.js';
import { InviteLinkModal } from './InviteLinkModal.js';

type Organization = { id: string; name: string; slug: string; role?: string };
type Team = { id: string; name: string; slug: string };
type Modal = 'organization' | 'team' | null;

type Props = {
  organizations: Organization[];
  organization: Organization | undefined;
  teams: Team[];
  onSelectOrganization: (id: string) => void;
  onChanged: () => void;
  onOpenTeam?: (teamId: string) => void;
  onOpenBilling?: (organizationId: string) => void;
  memberManagementDisabledReason?: string;
  openCreateOrganization?: boolean;
  onCreateOrganizationHandled?: () => void;
};

export function OrganizationPage({ organizations, organization, teams, onSelectOrganization, onChanged, onOpenTeam, onOpenBilling, memberManagementDisabledReason, openCreateOrganization = false, onCreateOrganizationHandled }: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [organizationInviteOpen, setOrganizationInviteOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [teamName, setTeamName] = useState('');

  useEffect(() => {
    if (openCreateOrganization) {
      setModal('organization');
      onCreateOrganizationHandled?.();
    }
  }, [onCreateOrganizationHandled, openCreateOrganization]);

  function closeModal() {
    setModal(null);
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    try {
      const created = await apiRequest<Organization>('/organizations', { method: 'POST', body: JSON.stringify({ name: orgName }) });
      setOrgName(''); closeModal(); onChanged(); onSelectOrganization(created.id);
    } catch { /* The request client has shown the failure. */ }
  }

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!organization) return;
    try { await apiRequest(`/organizations/${organization.id}/teams`, { method: 'POST', body: JSON.stringify({ name: teamName }) }); setTeamName(''); closeModal(); onChanged(); }
    catch { /* The request client has shown the failure. */ }
  }

  function openEditTeam(team: Team) {
    setEditingTeam(team);
    setTeamName(team.name);
  }

  async function updateTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!editingTeam) return;
    try {
      await apiRequest<Team>(`/teams/${editingTeam.id}`, { method: 'PATCH', body: JSON.stringify({ name: teamName }) });
      setEditingTeam(null);
      setTeamName('');
      onChanged();
    } catch { /* The request client has shown the failure. */ }
  }

  function openTeam(teamId: string) {
    if (onOpenTeam) onOpenTeam(teamId);
    else setActiveTeamId(teamId);
  }

  const activeTeam = teams.find((item) => item.id === activeTeamId);
  if (organization && activeTeam) return <TeamDetailPage organizationId={organization.id} team={activeTeam} onBack={() => setActiveTeamId(null)} onChanged={onChanged} />;

  return <section className={`management-page${organization ? ' team-management-page' : ''}`}>
    <div className="page-heading">
      <div><p className="eyebrow">团队</p><h2>{organization ? organization.name : '我的团队'}</h2></div>
      <div className="page-actions">
        {organization && <button className="secondary" type="button" onClick={() => onSelectOrganization('')}>返回组织列表</button>}
        {!organization && <button className="primary" type="button" onClick={() => setModal('organization')}>新增组织</button>}
        {organization && (organization.role === 'owner' || organization.role === 'admin') && <button className="secondary" type="button" title={memberManagementDisabledReason} disabled={Boolean(memberManagementDisabledReason)} onClick={() => setOrganizationInviteOpen(true)}>邀请加入组织</button>}
        {organization && <button className="secondary" type="button" onClick={() => onOpenBilling?.(organization.id)}>订阅与账单</button>}
        {organization && <button className="primary" type="button" onClick={() => setModal('team')}>新增团队</button>}
      </div>
    </div>
    {organization && memberManagementDisabledReason && <p className="billing-action-hint">{memberManagementDisabledReason}</p>}
    {!organization ? <div className="organization-grid">
      {organizations.map((item) => <button className="organization-card" type="button" key={item.id} onClick={() => onSelectOrganization(item.id)}><span className="card-mark">{item.name.slice(0, 1).toUpperCase()}</span><span className="card-copy"><strong>{item.name}</strong></span><span className="card-arrow">进入团队 →</span></button>)}
      {organizations.length === 0 && <div className="empty-state">还没有组织，点击右上角新增组织。</div>}
    </div> : <div className="team-grid">
      {teams.map((team) => <article className="team-card team-card-link" role="button" tabIndex={0} aria-label={`进入团队 ${team.name}`} key={team.id} onClick={() => openTeam(team.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openTeam(team.id); } }}><div className="team-card-heading"><span className="card-mark team-mark">{team.name.slice(0, 1).toUpperCase()}</span><div><h3>{team.name}</h3><p>查看成员、权限和关联项目。</p></div><button className="icon-button card-edit-button" type="button" aria-label={`编辑团队 ${team.name}`} title="编辑团队" onClick={(event) => { event.stopPropagation(); openEditTeam(team); }} onKeyDown={(event) => event.stopPropagation()}><span aria-hidden="true">✎</span></button></div><span className="card-arrow">进入团队 →</span></article>)}
      {teams.length === 0 && <div className="empty-state">这个组织还没有团队，点击右上角新增团队。</div>}
      <button className="team-card team-card-add" type="button" onClick={() => setModal('team')}><span>＋</span><strong>新增团队</strong></button>
    </div>}
    {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="management-modal-title"><div className="modal-heading"><div><p className="eyebrow">{modal === 'organization' ? '组织' : '团队'}</p><h3 id="management-modal-title">{modal === 'organization' ? '新增组织' : '新增团队'}</h3></div><button className="close-button" type="button" onClick={closeModal} aria-label="关闭">×</button></div>{modal === 'organization' && <form className="modal-form" onSubmit={createOrganization}><label>组织名称<input value={orgName} onChange={(event) => setOrgName(event.target.value)} required autoFocus /></label><ModalActions onCancel={closeModal} /></form>}{modal === 'team' && <form className="modal-form" onSubmit={createTeam}><label>团队名称<input value={teamName} onChange={(event) => setTeamName(event.target.value)} required autoFocus /></label><ModalActions onCancel={closeModal} /></form>}</div></div>}
    {editingTeam && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingTeam(null); }}><form className="modal-panel modal-form" onSubmit={updateTeam} role="dialog" aria-modal="true" aria-labelledby="edit-team-modal-title"><div className="modal-heading"><div><p className="eyebrow">团队</p><h3 id="edit-team-modal-title">编辑团队</h3></div><button className="close-button" type="button" onClick={() => setEditingTeam(null)} aria-label="关闭">×</button></div><label>团队名称<input aria-label="团队名称" value={teamName} onChange={(event) => setTeamName(event.target.value)} required autoFocus /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setEditingTeam(null)}>取消</button><button className="primary" type="submit">保存团队</button></div></form></div>}
    {organizationInviteOpen && organization && <InviteLinkModal eyebrow="组织成员" title="生成组织邀请链接" description={`对方打开链接并登录后，可以直接加入“${organization.name}”。`} path={`/organizations/${organization.id}/invite-links`} onClose={() => { setOrganizationInviteOpen(false); onChanged(); }} />}
  </section>;
}

function ModalActions({ onCancel, submitLabel = '创建' }: { onCancel: () => void; submitLabel?: string }) {
  return <div className="modal-actions"><button className="secondary" type="button" onClick={onCancel}>取消</button><button className="primary" type="submit">{submitLabel}</button></div>;
}
