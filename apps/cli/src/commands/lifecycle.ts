import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient } from '../api-client.js';
import { loadProjectConfig } from '../config.js';
import { requireSession } from '../errors.js';
import { installCodexSkill } from './install-codex.js';
import { cliVersion } from '../version.js';
import type { ServerInfo } from '../api-client.js';

export async function warnServerCompatibility(client: { serverInfo(): Promise<ServerInfo> }): Promise<void> {
  try {
    const info = await client.serverInfo();
    const missing = ['mutation-id', 'structured-tests', 'work-log-edit'].filter((capability) => !info.capabilities.includes(capability) && !(capability === 'structured-tests' && info.capabilities.includes('structured-reports')));
    if (!info.capabilities.includes('sync-feed') && !info.capabilities.includes('incremental-sync')) missing.push('sync-feed');
    if (missing.length) console.warn(`服务端 ${info.version} 缺少能力 ${missing.join(', ')}；相关功能将使用兼容模式，建议升级服务端。`);
  } catch (error) { console.warn(`无法检查服务端版本：${error instanceof Error ? error.message : String(error)}；继续现有项目访问检查。`); }
}

type DaemonLock = { pid: number; instanceId: string; root: string; cliVersion?: string; protocolVersion?: number };
type Runtime = {
  isAlive: (pid: number) => boolean;
  command: (pid: number) => string;
  signal: (pid: number, signal: NodeJS.Signals) => void;
};

const runtime: Runtime = {
  isAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
  },
  command(pid) {
    try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(); }
    catch { return ''; }
  },
  signal(pid, signal) { process.kill(pid, signal); },
};

function lockPath(root: string) { return join(resolve(root), '.vibe', 'daemon.lock'); }

function readLock(root: string): DaemonLock | undefined {
  try {
    const value = JSON.parse(readFileSync(lockPath(root), 'utf8')) as Partial<DaemonLock>;
    if (typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 && typeof value.instanceId === 'string' && value.instanceId && value.root === resolve(root)) return value as DaemonLock;
  } catch { /* A missing or malformed lock is not a running daemon. */ }
  return undefined;
}

export function daemonStatus(root = process.cwd(), system: Pick<Runtime, 'isAlive' | 'command'> = runtime): { running: false; stale?: true } | { running: true; pid: number; cliVersion?: string; protocolVersion?: number } {
  const lock = readLock(root);
  if (!lock) return existsSync(lockPath(root)) ? { running: false, stale: true } : { running: false };
  const marker = `vibeplan-daemon:${lock.instanceId}`;
  return system.isAlive(lock.pid) && system.command(lock.pid).includes(marker)
    ? { running: true, pid: lock.pid, ...(lock.cliVersion ? { cliVersion: lock.cliVersion } : {}), ...(lock.protocolVersion ? { protocolVersion: lock.protocolVersion } : {}) }
    : { running: false, stale: true };
}

export function clearStaleLock(root = process.cwd(), system: Pick<Runtime, 'isAlive' | 'command'> = runtime): boolean {
  const path = lockPath(root);
  if (!existsSync(path)) return false;
  try {
    const original = readFileSync(path, 'utf8');
    const value = JSON.parse(original) as { pid?: unknown; root?: unknown };
    if (typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0 || (value.root !== undefined && value.root !== resolve(root)) || system.isAlive(value.pid)) return false;
    if (readFileSync(path, 'utf8') !== original) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function stopDaemon(root = process.cwd(), system: Runtime = runtime): Promise<boolean> {
  const status = daemonStatus(root, system);
  if (!status.running) return false;
  system.signal(status.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!daemonStatus(root, system).running) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Daemon did not stop within 4 seconds. Check .vibe/daemon.log.');
}

export async function startDaemon(root = process.cwd()): Promise<{ pid: number; alreadyRunning: boolean }> {
  const config = loadProjectConfig(root);
  if (!config) throw new Error('当前目录未绑定项目。先在 https://vibeplan.szxinjin.cn/projects 创建或选择项目，然后运行 `vibeplan init --project-id PROJECT_ID`。');
  const session = await requireSession();
  const client = new ApiClient(session.server, session);
  await warnServerCompatibility(client);
  await client.project(config.projectId);
  const existing = daemonStatus(root);
  if (existing.running) {
    if (existing.cliVersion !== cliVersion || existing.protocolVersion !== 2) console.warn('后台运行旧版 CLI。请运行 vibeplan stop 后再运行 vibeplan start 以使用新功能。');
    return { pid: existing.pid, alreadyRunning: true };
  }
  if (existing.stale && !clearStaleLock(root)) throw new Error('发现无法验证的 daemon.lock。请检查是否仍有旧版 daemon 在运行，再清理该锁文件。');

  try { installCodexSkill(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already exists with different content')) throw error;
    console.warn('Codex Skill 与已安装版本不同，未覆盖用户文件。确认无自定义内容后可运行 `vibeplan install-codex --force`。');
  }

  const instanceId = randomUUID();
  const script = fileURLToPath(new URL('../index.js', import.meta.url));
  let child;
  child = spawn(process.execPath, [script, 'daemon', '--foreground', '--instance-id', instanceId], {
    cwd: resolve(root), detached: true, stdio: 'ignore',
  });
  let launchError: Error | undefined;
  child.once('error', (error) => { launchError = error; });
  child.unref();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const lock = readLock(root);
    if (lock?.instanceId === instanceId && daemonStatus(root).running) return { pid: lock.pid, alreadyRunning: false };
    if (launchError || child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`后台同步未能启动${launchError ? `：${launchError.message}` : '。请查看 .vibe/daemon.log。'}`);
}
