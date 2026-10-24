import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
export type SyncState = { projectId?: string; server?: string; cursor?: string; managedIds?: string[]; lastFullAt?: string; lastSuccessAt?: string; count?: number; error?: string };
export function readSyncState(root = process.cwd()): SyncState {
  try { return JSON.parse(readFileSync(join(root, '.vibe', 'sync-state.json'), 'utf8')); } catch { return {}; }
}
export function writeSyncState(state: SyncState, root = process.cwd()): void {
  mkdirSync(join(root, '.vibe'), { recursive: true });
  const path = join(root, '.vibe', 'sync-state.json');
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2), 'utf8'); renameSync(`${path}.tmp`, path);
}
export function daemonLog(root: string, message: string): void {
  mkdirSync(join(root, '.vibe'), { recursive: true });
  const path = join(root, '.vibe', 'daemon.log');
  if (existsSync(path) && statSync(path).size + Buffer.byteLength(message) >= 5 * 1024 * 1024) {
    if (existsSync(`${path}.5`)) unlinkSync(`${path}.5`);
    for (let i = 4; i >= 1; i--) if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
    renameSync(path, `${path}.1`);
  }
  appendFileSync(path, `${new Date().toISOString()} ${message.slice(0, 1024 * 1024)}\n`, 'utf8');
}
