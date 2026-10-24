import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ApiClient, normalizeServer } from '../api-client.js';
import { loadSession } from '../auth.js';
import { loadProjectConfig } from '../config.js';
import { makePlan, validatePlan, checkArgv, type BatchTask } from '../batch/plan.js';
import { executePlan, type BatchClient, type RunState } from '../batch/runner.js';
import { runCodex, runCheck } from '../batch/executor.js';

const defaultFile = '.vibe/batch-plan.json';
class BatchApiClient extends ApiClient {
  override request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
    return super.request<T>(path, { ...init, signal: init.signal ?? AbortSignal.timeout(20000) }, allowRefresh);
  }
}
function atomicJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}
async function boundClient() {
  const config = loadProjectConfig();
  if (!config) throw new Error('先在项目根目录运行 vibeplan init --project-id PROJECT_ID。');
  const session = await loadSession();
  if (!session) throw new Error('未登录。请运行 vibeplan login。');
  if (normalizeServer(session.server) !== normalizeServer(config.server)) throw new Error('登录服务器与项目绑定不同。');
  const client = new BatchApiClient(config.server, session), actor = await client.me();
  return { config, client, actorId: actor.id };
}
export async function preparePlan(options: { file?: string; task?: string[]; check?: string[] }) {
  const { config, client, actorId } = await boundClient();
  const checks = (options.check ?? []).map((json) => { const argv: unknown = JSON.parse(json); checkArgv(argv); return argv; });
  const plan = makePlan({ projectId: config.projectId, server: normalizeServer(config.server), actorId }, await client.workItems(config.projectId) as BatchTask[], options.task ?? [], checks);
  const path = resolve(options.file ?? defaultFile);
  if (existsSync(path)) throw new Error(`计划文件已存在：${path}。请检查现有执行状态，或用 --file 指定新文件，避免覆盖。`);
  atomicJson(path, plan);
  console.log(`计划已保存：${path}\n包含 ${plan.tasks.length} 个任务。检查任务范围、tasks[].checks 和 integrationChecks；每项任务必须有详细计划和验收标准。\n执行：vibeplan plan:run --file ${JSON.stringify(options.file ?? defaultFile)} --approve\n自动验收需另外加 --auto-accept（使用当前账号的验收权限）。`);
}
export function planStatus(file = defaultFile) {
  const path = resolve(file), statePath = `${path}.state.json`;
  if (!existsSync(statePath)) { console.log('计划尚未执行。'); return; }
  console.log(JSON.stringify(JSON.parse(readFileSync(statePath, 'utf8')), null, 2));
  console.log(`日志：${path}.runs/batch.log`);
}
function acquireLock(root: string): () => void {
  const path = join(root, '.vibe', 'batch.lock');
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const lock = JSON.parse(readFileSync(path, 'utf8')) as { pid: number };
    if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error(`无法验证执行锁：${path}`);
    let running = true;
    try { process.kill(lock.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false; }
    if (running) throw new Error(`已有计划执行进程（PID ${lock.pid}）。`);
    unlinkSync(path); // exact project-owned stale lock, proven process absent
  }
  const fd = openSync(path, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd);
  return () => { unlinkSync(path); };
}
export async function runPlan(options: { file?: string; approve?: boolean; autoAccept?: boolean; resume?: boolean }) {
  if (!options.approve) throw new Error('先检查计划 JSON，然后加 --approve 一次授权任务范围和测试命令。自动验收另需 --auto-accept。');
  const root = process.cwd(), path = resolve(options.file ?? defaultFile), statePath = `${path}.state.json`, outputDir = `${path}.runs`;
  const plan = validatePlan(JSON.parse(readFileSync(path, 'utf8')));
  const { config, client, actorId } = await boundClient();
  if (config.projectId !== plan.projectId || normalizeServer(config.server) !== normalizeServer(plan.server) || actorId !== plan.actorId) throw new Error('计划的项目、服务器或账号与当前绑定不一致。请重新生成计划。');
  execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, stdio: 'pipe' });
  if (!(await client.serverInfo()).capabilities.includes('structured-tests')) throw new Error('请先升级服务端以支持结构化测试证据。');
  const release = acquireLock(root);
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; };
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt);
  try {
    const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) as RunState : undefined;
    if (previous && !options.resume) throw new Error('已有执行记录。使用 plan:status 查看，确认后加 --resume 继续。');
    mkdirSync(outputDir, { recursive: true });
    const log = (message: string) => { console.log(message); appendFileSync(join(outputDir, 'batch.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }); };
    const adapter: BatchClient = {
      workItem: (id) => client.workItem(id) as Promise<BatchTask>,
      permissions: (id) => client.request(`/work-items/${id}/permissions`),
      update: (id, v, patch, m) => client.updateWorkItem(id, v, patch, m) as Promise<BatchTask>,
      report: (id, v, input, m) => client.reportWorkItem(id, { ...input, version: v }, m) as Promise<BatchTask>,
      review: (id, v, criterionId, reason) => client.request(`/work-items/${id}/acceptance-items/${encodeURIComponent(criterionId)}`, { method: 'PATCH', body: JSON.stringify({ version: v, status: 'passed', comment: reason, evidence: [] }) }),
      accept: (id, v, comment, m) => client.acceptWorkItem(id, { version: v, decision: 'approved', comment }, m) as Promise<BatchTask>,
    };
    log(`计划执行启动：${plan.tasks.length} 项 · ${options.autoAccept ? '预授权自动验收' : '交付后人工验收'}`);
    const state = await executePlan(plan, previous, !!options.autoAccept, root, outputDir, { client: adapter, codex: runCodex, check: runCheck, save: (s) => atomicJson(statePath, s), log, isInterrupted: () => interrupted });
    log(`计划结果：${state.outcome}。完整状态：${statePath}；日志：${outputDir}`);
    if (state.outcome === 'failed') process.exitCode = 1;
  } finally { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt); release(); }
}
