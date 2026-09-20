import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { WorkItemBoard, type WorkItem } from './WorkItemBoard.js';
import { WorkItemDetail } from './WorkItemDetail.js';
import { useProjectEvents } from './useProjectEvents.js';

type Organization = { id: string; name: string; slug: string };
type Team = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string; teamId: string };

export function WorkspacePage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<WorkItem | null>(null);
  useEffect(() => {
    apiRequest<Organization[]>('/organizations').then((value) => {
      setOrganizations(value);
      setOrganizationId(value[0]?.id ?? '');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载组织'));
  }, []);
  useEffect(() => {
    if (!organizationId) return;
    apiRequest<Team[]>(`/organizations/${organizationId}/teams`).then((value) => {
      setTeams(value);
      setTeamId(value[0]?.id ?? '');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载团队'));
    apiRequest<Project[]>(`/organizations/${organizationId}/projects`).then(setProjects)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载项目'));
  }, [organizationId]);
  useEffect(() => {
    const project = projects.find((item) => item.teamId === teamId) ?? projects[0];
    setProjectId(project?.id ?? null);
  }, [projects, teamId]);
  const refresh = useCallback(() => {
    if (!projectId) return;
    apiRequest<WorkItem[]>(`/projects/${projectId}/work-items`).then(setItems)
      .catch((cause) => setError(cause instanceof Error ? cause.message : '无法加载任务'));
  }, [projectId]);
  useEffect(refresh, [refresh]);
  useProjectEvents(projectId, refresh);

  return (
    <div className="workspace-page">
      <header className="topbar">
        <div><span className="eyebrow">{organizations.find((item) => item.id === organizationId)?.name ?? '未选择组织'} / {teams.find((item) => item.id === teamId)?.name ?? '未选择团队'}</span><h1>项目计划</h1></div>
        <button className="secondary">同步项目</button>
      </header>
      <section className="context-bar" aria-label="项目上下文">
        <label>组织<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>团队<select value={teamId} onChange={(event) => setTeamId(event.target.value)}>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>项目<select value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>{projects.filter((item) => !teamId || item.teamId === teamId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </section>
      {error && <p className="error workspace-error">{error}</p>}
      <nav className="project-tabs"><button className="active">任务看板</button><button>代码关系</button><button>活动记录</button></nav>
      {projectId ? <WorkItemBoard items={items} onSelect={setSelected} /> : <div className="empty-state">当前组织还没有可见项目。</div>}
      <WorkItemDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
