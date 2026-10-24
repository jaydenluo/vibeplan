import { useEffect, useState } from 'react';
import { apiRequest, showMessage } from '../api/client.js';

type Team = { id: string; name: string; slug: string };
type Project = { id: string; name: string; slug: string; teamId: string; description?: string | null; repositoryUrl?: string | null };

type Props = { teams: Team[]; projects: Project[]; onChanged: () => void; onOpen: (projectId: string) => void; createDisabledReason?: string };

export function ProjectsPage({ teams, projects, onChanged, onOpen, createDisabledReason }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (!teams.some((team) => team.id === teamId)) setTeamId(teams[0]?.id ?? '');
  }, [teamId, teams]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    try {
      await apiRequest<Project>(`/teams/${teamId}/projects`, { method: 'POST', body: JSON.stringify({ name, description: description.trim() }) });
      setName(''); setDescription(''); setShowCreate(false); onChanged();
    } catch { /* The request client has shown the failure. */ }
  }

  function openEdit(project: Project) {
    setEditing(project);
    setEditName(project.name);
    setEditDescription(project.description ?? '');
  }

  async function copyInitCommand(projectId: string) {
    const command = `vibeplan init --project-id ${projectId}`;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
      showMessage('复制成功，请到项目下运行命令');
      return;
    }
    const input = document.createElement('textarea');
    input.value = command;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showMessage('复制成功，请到项目下运行命令');
  }

  async function updateProject(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      await apiRequest<Project>(`/projects/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name: editName, description: editDescription.trim() }) });
      setEditing(null);
      onChanged();
    } catch { /* The request client has shown the failure. */ }
  }

  return <section className="management-page projects-page">
    <header className="page-heading"><div><p className="eyebrow">工作区</p><h2>项目</h2></div><div className="page-actions"><span className="muted">{projects.length} 个项目</span><button className="primary" type="button" title={createDisabledReason} disabled={Boolean(createDisabledReason)} onClick={() => setShowCreate(true)}>新增项目</button></div></header>
    {createDisabledReason && <p className="billing-action-hint">{createDisabledReason}</p>}
    {projects.length === 0 ? <div className="empty-state project-empty"><strong>还没有项目</strong><span>创建一个项目，开始管理任务与子任务。</span><button className="primary" type="button" title={createDisabledReason} disabled={Boolean(createDisabledReason)} onClick={() => setShowCreate(true)}>创建第一个项目</button></div> : <div className="project-card-grid" aria-label="项目列表">{projects.map((project) => { const team = teams.find((item) => item.id === project.teamId); return <article className="project-card" role="button" tabIndex={0} aria-label={`打开项目 ${project.name}`} key={project.id} onClick={() => onOpen(project.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(project.id); } }}><div className="project-card-top"><span className="project-card-mark">{project.name.slice(0, 1).toUpperCase()}</span><div><strong>{project.name}</strong><small>{team?.name ?? '未关联团队'}</small></div><div className="project-card-actions"><button className="icon-button" type="button" aria-label={`复制项目初始化命令 ${project.name}`} title="点击复制命令到本地项目根目录运行" onClick={(event) => { event.stopPropagation(); void copyInitCommand(project.id); }} onKeyDown={(event) => event.stopPropagation()}><span aria-hidden="true">⧉</span></button><button className="icon-button card-edit-button" type="button" aria-label={`编辑${project.name}`} title="编辑项目" onClick={(event) => { event.stopPropagation(); openEdit(project); }} onKeyDown={(event) => event.stopPropagation()}><span aria-hidden="true">✎</span></button></div></div>{project.description && <p className="project-card-description">{project.description}</p>}<span className="project-card-footer"><span>进入项目管理</span><span aria-hidden="true">→</span></span></article>; })}</div>}
    {showCreate && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}><form className="modal-panel modal-form" onSubmit={createProject}><div className="modal-heading"><div><p className="eyebrow">项目</p><h3>新增项目</h3></div><button className="close-button" type="button" onClick={() => setShowCreate(false)} aria-label="关闭">×</button></div><label>团队<select aria-label="团队" value={teamId} onChange={(event) => setTeamId(event.target.value)} required disabled={teams.length === 0}>{teams.length === 0 ? <option value="">暂无可用团队，请先创建团队</option> : teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>项目描述<textarea aria-label="项目描述" value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="简要说明项目目标和范围（可选）" /></label><div className="modal-actions"><button className="secondary" type="button" onClick={() => setShowCreate(false)}>取消</button><button className="primary" type="submit" disabled={!teamId}>创建项目</button></div></form></div>}
    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}><form className="modal-panel modal-form project-edit-modal" onSubmit={updateProject}><div className="modal-heading"><div><p className="eyebrow">项目</p><h3>编辑项目</h3></div><button className="close-button" type="button" onClick={() => setEditing(null)} aria-label="关闭">×</button></div><label>项目名称<input aria-label="项目名称" value={editName} onChange={(event) => setEditName(event.target.value)} required /></label><label>项目描述<textarea aria-label="项目描述" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} rows={7} placeholder="简要说明项目目标和范围（可选）" /></label><div className="project-init-command"><p>复制命令到本地项目根目录运行：</p><code>vibeplan init --project-id {editing.id}</code><button className="icon-button" type="button" aria-label="复制项目初始化命令" title="复制命令" onClick={() => void copyInitCommand(editing.id)}><span aria-hidden="true">⧉</span></button></div><div className="modal-actions"><button className="secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="primary" type="submit">保存项目</button></div></form></div>}
  </section>;
}
