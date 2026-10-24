import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clearStaleLock, daemonStatus, startDaemon, stopDaemon, warnServerCompatibility } from './lifecycle.js';

function projectRoot() {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-lifecycle-'));
  mkdirSync(join(root, '.vibe'));
  return root;
}

describe('daemon lifecycle', () => {
  it('does not clear an exited process lock belonging to another project', () => {
    const root = projectRoot();
    writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 1234, root: '/another-project' }));
    expect(clearStaleLock(root, { isAlive: () => false, command: () => '' })).toBe(false);
  });
  it('warns about unsupported server capabilities and tolerates unavailable version diagnostics', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await warnServerCompatibility({ serverInfo: async () => ({ version: 'legacy', protocolVersion: 1, capabilities: [] }) });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('mutation-id'));
    await expect(warnServerCompatibility({ serverInfo: async () => { throw new Error('offline'); } })).resolves.toBeUndefined();
    expect(warning).toHaveBeenLastCalledWith(expect.stringContaining('offline'));
    warning.mockRestore();
  });
  it('refuses to start from an unbound directory', async () => {
    const root = projectRoot();
    try {
      await expect(startDaemon(root)).rejects.toThrow('当前目录未绑定项目');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports stopped when there is no project lock', () => {
    const root = projectRoot();
    try {
      expect(daemonStatus(root)).toEqual({ running: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not stop a process when the lock instance cannot be verified', async () => {
    const root = projectRoot();
    const signal = vi.fn();
    try {
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 1234, instanceId: 'instance-1', root }));
      expect(daemonStatus(root, { isAlive: () => true, command: () => 'node unrelated.js' })).toEqual({ running: false, stale: true });
      await expect(stopDaemon(root, { isAlive: () => true, command: () => 'node unrelated.js', signal })).resolves.toBe(false);
      expect(signal).not.toHaveBeenCalled();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a lock with a nonpositive PID', () => {
    const root = projectRoot();
    try {
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 0, instanceId: 'instance-1', root }));
      expect(daemonStatus(root, { isAlive: () => true, command: () => 'vibeplan-daemon:instance-1' })).toEqual({ running: false, stale: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('clears a legacy lock only after confirming its process has exited', () => {
    const root = projectRoot();
    try {
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 1234, startedAt: new Date().toISOString() }));
      expect(clearStaleLock(root, { isAlive: () => false, command: () => '' })).toBe(true);
      expect(daemonStatus(root)).toEqual({ running: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps an unverifiable legacy lock while its PID is alive', () => {
    const root = projectRoot();
    try {
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 1234, startedAt: new Date().toISOString() }));
      expect(clearStaleLock(root, { isAlive: () => true, command: () => 'node unrelated.js' })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('signals only the matching instance for this project', async () => {
    const root = projectRoot();
    const signal = vi.fn(() => { rmSync(join(root, '.vibe', 'daemon.lock')); });
    try {
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: 1234, instanceId: 'instance-1', root }));
      const runtime = { isAlive: () => true, command: () => 'vibeplan-daemon:instance-1', signal };
      expect(daemonStatus(root, runtime)).toEqual({ running: true, pid: 1234 });
      await expect(stopDaemon(root, runtime)).resolves.toBe(true);
      expect(signal).toHaveBeenCalledWith(1234, 'SIGTERM');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops one real daemon process without stopping another project', async () => {
    const roots = [projectRoot(), projectRoot()];
    const children = roots.map((root) => {
      const instanceId = randomUUID();
      const child = spawn(process.execPath, ['-e', `process.title = 'vibeplan-daemon:${instanceId}'; setInterval(() => {}, 1000);`], {
        cwd: root, stdio: 'ignore',
      });
      writeFileSync(join(root, '.vibe', 'daemon.lock'), JSON.stringify({ pid: child.pid, instanceId, root }));
      return child;
    });
    try {
      for (let attempt = 0; attempt < 30 && !roots.every((root) => daemonStatus(root).running); attempt += 1) {
        await new Promise((done) => setTimeout(done, 50));
      }
      expect(roots.map((root) => daemonStatus(root).running)).toEqual([true, true]);
      await expect(stopDaemon(roots[0])).resolves.toBe(true);
      expect(daemonStatus(roots[1]).running).toBe(true);
    } finally {
      for (const child of children) child.kill('SIGTERM');
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });
});
