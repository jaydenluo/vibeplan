import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { type Session } from '../auth.js';
import { type ProjectConfig } from '../config.js';
import { listOutbox, type OutboxEvent } from '../sync/outbox.js';
import { daemonStatus } from './lifecycle.js';
import { readSyncState } from '../sync/state.js';
import { inspectCodexSkill } from './install-codex.js';
import type { ServerInfo } from '../api-client.js';

type RemoteUser = { id: string; email: string; displayName?: string | null };
type RemoteTask = { id: string; title: string; status: string; priority: string; dueDate?: string | null; unresolvedBlockerCount?: number; health?: { unresolvedBlockerCount?: number }; blockers?: unknown[] };
type StatusClient = { me(): Promise<RemoteUser>; workItems(projectId: string): Promise<unknown[]>; serverInfo?(): Promise<ServerInfo> };
type GitState = { branch: string; commit: string; dirty: boolean };
type DaemonState = ReturnType<typeof daemonStatus>;
type TaskSummary = { total: number; byStatus: Record<string, number>; next?: Pick<RemoteTask, 'id' | 'title' | 'priority' | 'dueDate' | 'status'>; error?: string };

export type StatusDependencies = {
  cliVersion: string;
  loadSession: () => Promise<Session | undefined>;
  createClient: (server: string, session: Session) => StatusClient;
  loadProjectConfig: (root: string) => ProjectConfig | undefined;
  daemonStatus: (root: string) => DaemonState;
  listOutbox: (root: string) => OutboxEvent[];
  gitState: (root: string) => GitState | undefined;
  lastLogUpdatedAt: (root: string) => string | undefined;
};

export type VibePlanStatus = {
  cliVersion: string;
  session: { state: 'not_logged_in' } | { state: 'authenticated'; email: string; displayName?: string | null; server: string } | { state: 'unavailable'; server: string; message: string };
  project?: ProjectConfig & { root: string };
  daemon: DaemonState;
  sync: { pendingEvents: number; failedEvents: number; pausedEvents?: number; lastLogUpdatedAt?: string; lastSuccessAt?: string; count?: number; error?: string };
  server?: ServerInfo;
  skill?: 'current' | 'missing' | 'different';
  skillTemplate?: ReturnType<typeof inspectCodexSkill>;
  git?: GitState;
  tasks?: TaskSummary;
};

export function readGitState(root: string): GitState | undefined {
  try {
    const value = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = value(['branch', '--show-current']) || 'detached';
    const commit = value(['rev-parse', '--short', 'HEAD']);
    const dirty = value(['status', '--porcelain']).length > 0;
    return { branch, commit, dirty };
  } catch {
    return undefined;
  }
}

export function readLogUpdatedAt(root: string): string | undefined {
  try {
    const path = join(resolve(root), '.vibe', 'daemon.log');
    return existsSync(path) ? statSync(path).mtime.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

export function chooseNextTask(tasks: RemoteTask[]): TaskSummary['next'] {
  const statusRank: Record<string, number> = { in_progress: 0, ready: 1, backlog: 2, blocked: 3, in_review: 4 };
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  const candidates = tasks.filter((task) => ['in_progress', 'ready', 'backlog'].includes(task.status) && !(task.unresolvedBlockerCount ?? task.health?.unresolvedBlockerCount ?? task.blockers?.length ?? 0)).sort((left, right) => {
    const statusDelta = (statusRank[left.status] ?? 5) - (statusRank[right.status] ?? 5);
    if (statusDelta !== 0) return statusDelta;
    const priorityDelta = (priorityRank[left.priority] ?? 5) - (priorityRank[right.priority] ?? 5);
    if (priorityDelta !== 0) return priorityDelta;
    return (left.dueDate ?? '9999-12-31').localeCompare(right.dueDate ?? '9999-12-31') || left.id.localeCompare(right.id);
  });
  const task = candidates[0];
  return task && { id: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate, status: task.status };
}

export async function collectStatus(root = process.cwd(), dependencies: StatusDependencies): Promise<VibePlanStatus> {
  const resolvedRoot = resolve(root);
  const project = dependencies.loadProjectConfig(resolvedRoot);
  const outbox = dependencies.listOutbox(resolvedRoot);
  const git = dependencies.gitState(resolvedRoot);
  const syncState = readSyncState(resolvedRoot);
  const skillTemplate = inspectCodexSkill();
  const base: Omit<VibePlanStatus, 'session'> = {
    cliVersion: dependencies.cliVersion,
    ...(project ? { project: { ...project, root: resolvedRoot } } : {}),
    daemon: dependencies.daemonStatus(resolvedRoot),
    sync: { pendingEvents: outbox.length, failedEvents: outbox.filter((event) => event.retryCount > 0).length, pausedEvents: outbox.filter((event) => event.paused).length, lastLogUpdatedAt: dependencies.lastLogUpdatedAt(resolvedRoot), lastSuccessAt: syncState.lastSuccessAt, count: syncState.count, error: syncState.error },
    skill: skillTemplate.state,
    skillTemplate,
    ...(git ? { git } : {}),
  };
  const session = await dependencies.loadSession();
  if (!session) return { ...base, session: { state: 'not_logged_in' } };

  const client = dependencies.createClient(session.server, session);
  try {
    const user = await client.me();
    const status: VibePlanStatus = { ...base, session: { state: 'authenticated', email: user.email, displayName: user.displayName, server: session.server } };
    if (client.serverInfo) { try { status.server = await client.serverInfo(); } catch { /* Session and task diagnostics remain available. */ } }
    if (!project) return status;
    try {
      const remoteTasks = (await client.workItems(project.projectId)) as RemoteTask[];
      const byStatus = remoteTasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.status]: (counts[task.status] ?? 0) + 1 }), {});
      return { ...status, tasks: { total: remoteTasks.length, byStatus, next: chooseNextTask(remoteTasks) } };
    } catch (error) {
      return { ...status, tasks: { total: 0, byStatus: {}, error: message(error) } };
    }
  } catch (error) {
    return { ...base, session: { state: 'unavailable', server: session.server, message: message(error) } };
  }
}

function message(error: unknown): string {
  const value = error instanceof Error ? error.message : '未知错误';
  return /authentication is required|not logged in|登录已过期/i.test(value)
    ? '登录已失效，请运行 vibeplan login。'
    : value;
}

function formatDate(value?: string | null): string {
  if (!value) return '时间未设置';
  const [year, month, day] = value.split('-').map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) ? `${month}月${day}日` : value;
}

function label(status: string): string {
  return ({ backlog: '待规划', ready: '待开始', in_progress: '进行中', blocked: '已阻塞', in_review: '待审核', done: '已完成', cancelled: '已取消' } as Record<string, string>)[status] ?? status;
}

export function renderStatus(status: VibePlanStatus, verbose = false): string {
  const lines = ['Vibe Plan', `  CLI:        ${status.cliVersion}`];
  if (status.server) lines.push(`  服务版本:   ${status.server.version} · 协议 ${status.server.protocolVersion}`, `  服务能力:   ${status.server.capabilities.join(', ') || 'legacy'}`);
  if (status.skill) lines.push(`  Skill:      ${status.skill}`);
  if (status.skillTemplate) lines.push(`  Skill 模板: ${status.skillTemplate.installedTemplateVersion ?? 'legacy/uninstalled'} · 当前 ${status.skillTemplate.templateVersion}`);
  if (status.sync.lastSuccessAt) lines.push(`  同步成功:   ${status.sync.lastSuccessAt} · ${status.sync.count ?? 0} 个任务`);
  if (status.sync.error) lines.push(`  同步错误:   ${status.sync.error}`);
  if (status.session.state === 'authenticated') {
    lines.push(`  登录账号:   ${status.session.displayName ? `${status.session.displayName} <${status.session.email}>` : status.session.email}`);
    lines.push('  会话状态:   已验证，滑动续期');
    lines.push(`  服务端:     ${status.session.server}`);
  } else if (status.session.state === 'not_logged_in') {
    lines.push('  会话状态:   未登录');
    if (status.project) lines.push(`  服务端:     ${status.project.server}`);
  } else {
    lines.push(`  会话状态:   无法验证（${status.session.message}）`);
    lines.push(`  服务端:     ${status.session.server}`);
  }

  if (status.project) {
    lines.push(`  本地项目:   ${basename(status.project.root)}`);
    lines.push(`  同步状态:   ${status.sync.pendingEvents ? `待上传 ${status.sync.pendingEvents} 条${status.sync.failedEvents ? `，失败重试 ${status.sync.failedEvents} 条` : ''}` : '无待上传事件'}`);
    if (status.sync.pausedEvents) lines.push(`  暂停操作:   ${status.sync.pausedEvents} 条，使用 vibeplan sync:pending 检查并解决冲突`);
  } else {
    lines.push('  本地项目:   未绑定');
  }
  lines.push(`  Daemon:     ${status.daemon.running ? `运行中（PID ${status.daemon.pid}）` : status.daemon.stale ? '存在无法验证的锁记录' : '未运行'}`);
  if (status.daemon.running) lines.push(`  后台版本:   ${status.daemon.cliVersion ?? 'legacy'} · 协议 ${status.daemon.protocolVersion ?? 'unknown'}`);

  if (status.tasks) {
    lines.push('', '任务摘要');
    lines.push(`  总任务:     ${status.tasks.total}`);
    for (const name of ['in_progress', 'in_review', 'blocked', 'ready', 'backlog', 'done']) {
      if (status.tasks.byStatus[name]) lines.push(`  ${label(name)}:     ${status.tasks.byStatus[name]}`);
    }
    if (status.tasks.next) lines.push(`  项目推荐:   ${status.tasks.next.title} · ${status.tasks.next.priority} · ${formatDate(status.tasks.next.dueDate)}`);
    if (status.tasks.error) lines.push(`  任务摘要:   获取失败（${status.tasks.error}）`);
  }

  if (verbose) {
    lines.push('', '详细信息');
    if (status.project) {
      lines.push(`  项目 ID:    ${status.project.projectId}`);
      lines.push(`  团队 ID:    ${status.project.teamId}`);
      lines.push(`  组织 ID:    ${status.project.organizationId}`);
      lines.push(`  本地路径:   ${status.project.root}`);
    }
    if (status.git) lines.push(`  Git:        ${status.git.branch} · ${status.git.commit} · ${status.git.dirty ? '有未提交改动' : '工作区干净'}`);
    if (status.sync.lastLogUpdatedAt) lines.push(`  最后日志:   ${new Date(status.sync.lastLogUpdatedAt).toLocaleString('zh-CN')}`);
  }
  return `${lines.join('\n')}\n`;
}

export function statusDependencies(cliVersion: string, dynamic: Pick<StatusDependencies, 'loadSession' | 'createClient' | 'loadProjectConfig'>): StatusDependencies {
  return { cliVersion, ...dynamic, daemonStatus, listOutbox, gitState: readGitState, lastLogUpdatedAt: readLogUpdatedAt };
}
