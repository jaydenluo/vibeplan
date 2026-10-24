import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ClipboardCheck, FolderKanban, Kanban, LayoutDashboard, ShieldCheck, UsersRound } from 'lucide-react';
import { apiRequest, getBillingSummary, getPlatformAdminMe, type BillingSummary, type PlatformAdminIdentity } from '../api/client.js';
import { WorkItemBoard, type WorkItem } from './WorkItemBoard.js';
import { WorkItemDetail } from './WorkItemDetail.js';
import { WorkItemCreateForm } from './WorkItemCreateForm.js';
import { useProjectEvents } from './useProjectEvents.js';
import { OrganizationPage } from './OrganizationPage.js';
import { ProjectsPage } from './ProjectsPage.js';
import { ProjectManagementPage } from './ProjectManagementPage.js';
import { TeamDetailPage } from './TeamDetailPage.js';
import { ApprovalsPage } from './ApprovalsPage.js';
import { ProfileMenu } from './ProfileMenu.js';
import { InviteAcceptanceModal } from './InviteAcceptanceModal.js';
import { TodayWork } from './TodayWork.js';
import { OrganizationOverview } from './OrganizationOverview.js';
import { BillingPage } from './BillingPage.js';
import { AdminConsolePage } from './AdminConsolePage.js';
import { TaskActivity, TaskCodeRelations, type ProjectEvent } from './TaskProjectTabs.js';
import { appVersion } from '../version.js';

type Organization = { id: string; name: string; slug: string };
type Team = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string; teamId: string; description?: string | null; repositoryUrl?: string | null };
type User = { id: string; email: string; displayName?: string | null };
type View = 'overview' | 'teams' | 'projects' | 'approvals' | 'tasks' | 'billing' | 'admin';
type TaskTab = 'board' | 'relations' | 'activity';
type WorkspaceRoute = { view: View; projectId?: string; teamId?: string; organizationId?: string };

function isBillingSummary(value: unknown): value is BillingSummary {
  return Boolean(value && typeof value === 'object' && 'policy' in value && 'subscription' in value);
}

function asPlatformAdminIdentity(value: unknown): PlatformAdminIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { userId?: unknown; id?: unknown; email?: unknown; role?: unknown };
  const userId = typeof candidate.userId === 'string' ? candidate.userId : candidate.id;
  return typeof userId === 'string' && typeof candidate.email === 'string' && (candidate.role === 'super_admin' || candidate.role === 'operator')
    ? { userId, email: candidate.email, role: candidate.role }
    : null;
}

function routeFromLocation(): WorkspaceRoute {
  if (typeof window === 'undefined') return { view: 'overview' };
  const segments = window.location.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments[0] === 'organizations' && segments[1] && segments[2] === 'billing') return { view: 'billing', organizationId: segments[1] };
  if (segments[0] === 'admin') return { view: 'admin' };
  if (segments[0] === 'projects' && segments[1]) return { view: 'projects', projectId: segments[1] };
  if (segments[0] === 'teams' && segments[1]) return { view: 'teams', teamId: segments[1] };
  if (segments[0] === 'teams') return { view: 'teams' };
  if (segments[0] === 'projects') return { view: 'projects' };
  if (segments[0] === 'approvals') return { view: 'approvals' };
  if (segments[0] === 'tasks') return { view: 'tasks' };
  return { view: 'overview' };
}

function pathForView(view: View) {
  return view === 'overview' ? '/overview' : `/${view}`;
}

export function WorkspacePage({ inviteToken, onInviteHandled, onLogout }: { inviteToken?: string | null; onInviteHandled?: () => void; onLogout?: () => void } = {}) {
  const initialRoute = routeFromLocation();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizationId, setOrganizationId] = useState(() => initialRoute.organizationId ?? (typeof window !== 'undefined' ? window.localStorage.getItem('vibe-plan.organization') ?? '' : ''));
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<View>(initialRoute.view);
  const [projectManagementId, setProjectManagementId] = useState<string | null>(initialRoute.projectId ?? null);
  const [teamDetailId, setTeamDetailId] = useState<string | null>(initialRoute.teamId ?? null);
  const [createOrganizationRequest, setCreateOrganizationRequest] = useState(0);
  const [contextVersion, setContextVersion] = useState(0);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState<PlatformAdminIdentity | null>(null);
  const [platformAdminChecked, setPlatformAdminChecked] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem('vibe-plan.sidebar') === 'expanded');
  const [taskTab, setTaskTab] = useState<TaskTab>('board');
  const [projectEvents, setProjectEvents] = useState<ProjectEvent[]>([]);
  const [projectEventsLoading, setProjectEventsLoading] = useState(false);
  const [projectEventsError, setProjectEventsError] = useState('');
  useEffect(() => {
    apiRequest<User>('/auth/me').then(setUser).catch(() => undefined);
  }, []);
  useEffect(() => {
    let active = true;
    getPlatformAdminMe().then((value) => { if (active) setPlatformAdmin(asPlatformAdminIdentity(value)); }).catch(() => { if (active) setPlatformAdmin(null); }).finally(() => { if (active) setPlatformAdminChecked(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    window.localStorage.setItem('vibe-plan.sidebar', sidebarExpanded ? 'expanded' : 'collapsed');
  }, [sidebarExpanded]);
  useEffect(() => {
    const handlePopState = () => {
      const route = routeFromLocation();
      setView(route.view);
      setProjectManagementId(route.projectId ?? null);
      setTeamDetailId(route.teamId ?? null);
      if (route.organizationId) setOrganizationId(route.organizationId);
      if (route.projectId) setProjectId(route.projectId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  useEffect(() => {
    if (organizationId) window.localStorage.setItem('vibe-plan.organization', organizationId);
    else window.localStorage.removeItem('vibe-plan.organization');
  }, [organizationId]);
  useEffect(() => {
    apiRequest<Organization[]>('/organizations').then((value) => {
      setOrganizations(value);
      setOrganizationId((current) => value.some((item) => item.id === current) ? current : (value[0]?.id ?? ''));
    }).catch(() => undefined);
  }, [contextVersion]);
  useEffect(() => {
    if (!organizationId) {
      setTeams([]);
      setProjects([]);
      setTeamId('');
      setProjectId(null);
      return;
    }
    apiRequest<Team[]>(`/organizations/${organizationId}/teams`).then((value) => {
      setTeams(value);
      setTeamId(value[0]?.id ?? '');
    }).catch(() => undefined);
    apiRequest<Project[]>(`/organizations/${organizationId}/projects`).then(setProjects)
      .catch(() => undefined);
  }, [organizationId, contextVersion]);
  useEffect(() => {
    if (!organizationId) {
      setBillingSummary(null);
      return;
    }
    let active = true;
    getBillingSummary(organizationId).then((value) => { if (active) setBillingSummary(isBillingSummary(value) ? value : null); }).catch(() => { if (active) setBillingSummary(null); });
    return () => { active = false; };
  }, [organizationId, contextVersion]);
  useEffect(() => {
    const project = projects.find((item) => item.teamId === teamId) ?? projects[0];
    setProjectId(project?.id ?? null);
  }, [projects, teamId]);
  const refresh = useCallback(() => {
    if (!projectId) return;
    apiRequest<WorkItem[]>(`/projects/${projectId}/work-items`).then(setItems)
      .catch(() => undefined);
  }, [projectId]);
  const moveTaskToStatus = useCallback(async (item: WorkItem, status: string) => {
    if (item.status === status) return;
    const previousStatus = item.status;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status } : candidate));
    setSelected((current) => current?.id === item.id ? { ...current, status } : current);
    try {
      const updated = await apiRequest<WorkItem>(`/work-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: item.version ?? 1, status }),
      });
      setItems((current) => current.map((candidate) => candidate.id === item.id ? updated : candidate));
      setSelected((current) => current?.id === item.id ? updated : current);
    } catch {
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: previousStatus } : candidate));
      setSelected((current) => current?.id === item.id ? { ...current, status: previousStatus } : current);
    }
  }, []);
  useEffect(refresh, [refresh]);
  useProjectEvents(projectId, refresh);
  useEffect(() => {
    if (taskTab !== 'activity' || !projectId) return;
    let active = true;
    setProjectEventsLoading(true);
    setProjectEventsError('');
    apiRequest<ProjectEvent[]>(`/projects/${projectId}/events`).then((value) => { if (active) setProjectEvents(value); }).catch(() => { if (active) setProjectEventsError('unavailable'); }).finally(() => { if (active) setProjectEventsLoading(false); });
    return () => { active = false; };
  }, [projectId, taskTab]);
  useEffect(() => { setTaskTab('board'); setProjectEvents([]); }, [projectId]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    const route = routeFromLocation();
    setView(route.view);
    setProjectManagementId(route.projectId ?? null);
    setTeamDetailId(route.teamId ?? null);
    if (route.organizationId) setOrganizationId(route.organizationId);
    if (route.projectId) setProjectId(route.projectId);
  };
  const navigateToView = (nextView: View) => navigateTo(pathForView(nextView));
  const openProject = (id: string) => navigateTo(`/projects/${encodeURIComponent(id)}`);
  const openTeam = (id: string) => navigateTo(`/teams/${encodeURIComponent(id)}`);
  const openBilling = (id: string) => navigateTo(`/organizations/${encodeURIComponent(id)}/billing`);
  const refreshContext = () => setContextVersion((value) => value + 1);
  const organization = organizations.find((item) => item.id === organizationId);
  const teamDetail = teams.find((item) => item.id === teamDetailId);
  if (projectManagementId) {
    return <ProjectManagementPage projects={projects} activeProjectId={projectManagementId} onBack={() => navigateToView('projects')} onSelectProject={openProject} />;
  }

  return (
    <div className="workspace-layout">
      <aside className={`sidebar${sidebarExpanded ? ' expanded' : ''}`}>
        <div className="sidebar-brand"><span className="sidebar-logo" aria-hidden="true">V</span>{sidebarExpanded && <span className="sidebar-brand-copy"><span className="eyebrow">CODEX WORKSPACE</span><span className="sidebar-brand-product"><strong>Vibe Plan</strong><span className="app-version">v{appVersion}</span></span></span>}</div>
        {user && <ProfileMenu user={user} organizations={organizations} organizationId={organizationId} onSelectOrganization={(id) => { setOrganizationId(id); navigateToView('teams'); }} onCreateOrganization={() => { setOrganizationId(''); navigateToView('teams'); setCreateOrganizationRequest((value) => value + 1); }} onProfileUpdated={setUser} onLogout={onLogout} />}
        <nav className="sidebar-nav" aria-label="主导航">
          <button type="button" aria-label="总览" title="总览" className={view === 'overview' ? 'selected' : ''} onClick={() => navigateToView('overview')}><LayoutDashboard className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>总览</span>}</button>
          <button type="button" aria-label="项目管理" title="项目管理" className={view === 'projects' ? 'selected' : ''} onClick={() => navigateToView('projects')}><FolderKanban className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>项目管理</span>}</button>
          <button type="button" aria-label="任务看板" title="任务看板" className={view === 'tasks' ? 'selected' : ''} onClick={() => navigateToView('tasks')}><Kanban className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>任务看板</span>}</button>
          <button type="button" aria-label="团队管理" title="团队管理" className={view === 'teams' ? 'selected' : ''} onClick={() => navigateToView('teams')}><UsersRound className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>团队管理</span>}</button>
          <button type="button" aria-label="待办审批" title="待办审批" className={view === 'approvals' ? 'selected' : ''} onClick={() => navigateToView('approvals')}><ClipboardCheck className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>待办审批</span>}</button>
          {platformAdmin && <button type="button" aria-label="管理后台" title="管理后台" className={view === 'admin' ? 'selected' : ''} onClick={() => navigateToView('admin')}><ShieldCheck className="nav-icon" aria-hidden="true" strokeWidth={1.8} />{sidebarExpanded && <span>管理后台</span>}</button>}
        </nav>
        <button className="sidebar-toggle" type="button" aria-label={sidebarExpanded ? '收起菜单' : '展开菜单'} title={sidebarExpanded ? '收起菜单' : '展开菜单'} onClick={() => setSidebarExpanded((value) => !value)}><span aria-hidden="true">{sidebarExpanded ? '‹' : '›'}</span>{sidebarExpanded && <span>收起菜单</span>}</button>
      </aside>
      <main className={`workspace-page${view === 'tasks' ? ' workspace-page-tasks' : ''}`}>
      {view === 'overview' && <OrganizationOverview organizationId={organizationId} onOpenProjects={() => navigateToView('projects')} onOpenApprovals={() => navigateToView('approvals')} onOpenProject={openProject} />}
      {view === 'overview' && <TodayWork organizationId={organizationId} onOpenTask={(projectId, taskId) => navigateTo(`/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(taskId)}`)} />}
      {view === 'teams' && teamDetail && <TeamDetailPage organizationId={organizationId} team={teamDetail} onBack={() => navigateToView('teams')} onChanged={refreshContext} />}
      {view === 'teams' && !teamDetail && <OrganizationPage organizations={organizations} organization={organization} teams={teams} onSelectOrganization={(id) => { setOrganizationId(id); navigateToView('teams'); }} onOpenTeam={openTeam} onOpenBilling={openBilling} memberManagementDisabledReason={billingSummary && !billingSummary.policy.canManageMembers ? billingSummary.policy.denialReason ?? '当前套餐不支持成员管理。' : undefined} onChanged={refreshContext} openCreateOrganization={createOrganizationRequest > 0} onCreateOrganizationHandled={() => setCreateOrganizationRequest(0)} />}
      {view === 'billing' && organization && <BillingPage organizationId={organization.id} organizationName={organization.name} onBack={() => navigateToView('teams')} />}
      {view === 'billing' && !organization && <div className="empty-state">正在加载组织订阅信息…</div>}
      {view === 'admin' && !platformAdminChecked && <div className="empty-state">正在验证平台管理员权限…</div>}
      {view === 'admin' && platformAdminChecked && !platformAdmin && <section className="admin-denied"><p className="eyebrow">访问受限</p><h2>无权访问管理后台</h2><p className="muted">此区域仅供已由服务器确认的平台管理员使用。</p><button className="secondary" type="button" onClick={() => navigateToView('overview')}>返回总览</button></section>}
      {view === 'admin' && platformAdmin && <AdminConsolePage identity={platformAdmin} />}
      {view === 'projects' && <ProjectsPage teams={teams} projects={projects} createDisabledReason={billingSummary && !billingSummary.policy.canCreateProject ? billingSummary.policy.denialReason ?? '当前套餐不支持继续创建项目。' : undefined} onChanged={refreshContext} onOpen={(id) => { setProjectId(id); openProject(id); }} />}
      {view === 'approvals' && <ApprovalsPage teams={teams} onChanged={refreshContext} />}
      {view === 'tasks' && <div className="task-view">
      <div className="task-toolbar-row">
        <section className="context-bar" aria-label="项目上下文">
          <label className="context-select"><span className="sr-only">团队</span><select aria-label="团队" value={teamId} onChange={(event) => setTeamId(event.target.value)}>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="context-select-chevron" aria-hidden="true" size={18} strokeWidth={1.8} /></label>
          <label className="context-select"><span className="sr-only">项目</span><select aria-label="项目" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>{projects.filter((item) => !teamId || item.teamId === teamId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="context-select-chevron" aria-hidden="true" size={18} strokeWidth={1.8} /></label>
        </section>
        <nav className="project-tabs" role="tablist" aria-label="项目任务视图"><button type="button" role="tab" aria-selected={taskTab === 'board'} className={taskTab === 'board' ? 'active' : ''} onClick={() => setTaskTab('board')}>任务看板</button><button type="button" role="tab" aria-selected={taskTab === 'relations'} className={taskTab === 'relations' ? 'active' : ''} onClick={() => setTaskTab('relations')}>任务关系</button><button type="button" role="tab" aria-selected={taskTab === 'activity'} className={taskTab === 'activity' ? 'active' : ''} onClick={() => setTaskTab('activity')}>活动记录</button></nav>
      </div>
      {projectId && taskTab === 'board' ? <WorkItemBoard items={items} onSelect={setSelected} onMove={(item, status) => { void moveTaskToStatus(item, status); }} /> : projectId && taskTab === 'relations' ? <TaskCodeRelations project={projects.find((item) => item.id === projectId)} items={items} onSelect={setSelected} /> : projectId ? <TaskActivity items={items} events={projectEvents} loading={projectEventsLoading} error={projectEventsError} onSelect={setSelected} /> : <div className="empty-state">当前组织还没有可见项目。</div>}
      {creating && projectId && <WorkItemCreateForm projectId={projectId} onCreated={() => { setCreating(false); void refresh(); }} onCancel={() => setCreating(false)} />}
      <WorkItemDetail item={selected} onClose={() => setSelected(null)} />
      </div>}
      </main>
      {inviteToken && <InviteAcceptanceModal token={inviteToken} onHandled={() => { onInviteHandled?.(); refreshContext(); }} />}
    </div>
  );
}
