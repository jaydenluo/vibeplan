import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { flushOutbox, syncTasks } from './sync.js';
import { ApiClient } from '../api-client.js';
import { requireSession } from '../errors.js';
import { cliVersion } from '../version.js';
import { daemonLog } from '../sync/state.js';

type ProcessState = 'alive' | 'missing' | 'unknown';
function processState(pid: number): ProcessState {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'missing' : 'unknown';
  }
}

export function acquireDaemonLock(root: string, instanceId: string, probe: (pid: number) => ProcessState = processState): string {
  const directory = join(root, '.vibe');
  const lockPath = join(directory, 'daemon.lock');
  mkdirSync(directory, { recursive: true });
  if (existsSync(lockPath)) {
    let value: { pid?: unknown; root?: unknown };
    const original = readFileSync(lockPath, 'utf8');
    try { value = JSON.parse(original); }
    catch { throw new Error('Unverifiable daemon.lock preserved. Inspect the existing daemon before starting another.'); }
    if (!value || typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid <= 0 || (value.root !== undefined && value.root !== resolve(root))) throw new Error('Unverifiable or foreign-project daemon.lock preserved.');
    const state = probe(value.pid);
    if (state !== 'missing') throw new Error(`A daemon lock owner is ${state === 'alive' ? 'still alive' : 'unverifiable'} (PID ${value.pid}); lock preserved.`);
    if (readFileSync(lockPath, 'utf8') !== original) throw new Error('Daemon lock changed during inspection; retry without replacing it.');
    unlinkSync(lockPath);
  }
  const descriptor = openSync(lockPath, 'wx');
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid, instanceId, root: resolve(root), cliVersion, protocolVersion: 2, startedAt: new Date().toISOString() }), 'utf8');
  closeSync(descriptor);
  return lockPath;
}

function releaseLock(lockPath: string, instanceId: string): void {
  try {
    if (existsSync(lockPath) && JSON.parse(readFileSync(lockPath, 'utf8')).instanceId === instanceId) unlinkSync(lockPath);
  } catch {
    // The process is already stopping; a stale lock can be cleaned on next start.
  }
}

export async function runDaemon(root = process.cwd(), intervalMs = 2000, instanceId = randomUUID()): Promise<void> {
  const session = await requireSession();
  await new ApiClient(session.server, session).me();
  process.title = `vibeplan-daemon:${instanceId}`;
  const lockPath = acquireDaemonLock(root, instanceId);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let failures = 0;
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  console.log = (...args) => { daemonLog(root, args.map(String).join(' ')); if (process.stdout.isTTY) originalLog(...args); };
  console.error = (...args) => { daemonLog(root, args.map(String).join(' ')); if (process.stderr.isTTY) originalError(...args); };
  console.warn = (...args) => { daemonLog(root, args.map(String).join(' ')); if (process.stderr.isTTY) originalWarn(...args); };
  console.log('Vibe Plan daemon started. Press Ctrl-C to stop.');
  try {
    while (!stopping) {
      try {
        const flushed = await flushOutbox(root);
        await syncTasks(root);
        failures = flushed.failed ? failures + 1 : 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Task synchronization failed.';
        console.error(message);
        failures += 1;
      }
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, retryDelay(failures, intervalMs)));
    }
  } finally {
    releaseLock(lockPath, instanceId);
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.log('Vibe Plan daemon stopped.');
  }
}
export function retryDelay(failures: number, intervalMs = 2000, random = Math.random): number {
  if (!failures) return intervalMs;
  return Math.max(2000, Math.min(60000, 2000 * 2 ** Math.min(failures - 1, 5) * (0.8 + random() * 0.4)));
}
