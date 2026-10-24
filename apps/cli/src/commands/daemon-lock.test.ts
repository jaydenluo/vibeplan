import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { acquireDaemonLock } from './daemon.js';
function setup(content: string) {
  const root = mkdtempSync(join(tmpdir(), 'vibe-lock-'));
  mkdirSync(join(root, '.vibe')); const path = join(root, '.vibe', 'daemon.lock'); writeFileSync(path, content);
  return { root, path };
}
it('preserves malformed and unverifiable lock records', () => {
  for (const content of ['{broken', JSON.stringify({ pid: 0 }), JSON.stringify({ pid: 123, root: '/different-project' })]) {
    const { root, path } = setup(content);
    expect(() => acquireDaemonLock(root, 'new', () => 'missing')).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(content);
  }
});
it('preserves a lock while its process is alive or cannot be probed', () => {
  for (const state of ['alive', 'unknown'] as const) {
    const { root, path } = setup(JSON.stringify({ pid: 123 }));
    expect(() => acquireDaemonLock(root, 'new', () => state)).toThrow();
    expect(existsSync(path)).toBe(true);
  }
});
it('replaces only an exited process lock belonging to this project', () => {
  const { root, path } = setup(JSON.stringify({ pid: 123 }));
  expect(acquireDaemonLock(root, 'new', () => 'missing')).toBe(path);
  expect(JSON.parse(readFileSync(path, 'utf8')).instanceId).toBe('new');
});
