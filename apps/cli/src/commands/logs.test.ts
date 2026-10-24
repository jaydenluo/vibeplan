import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRecentDaemonLogs, followDaemonLogs } from './logs.js';

function projectRoot() {
  const root = mkdtempSync(join(tmpdir(), 'vibeplan-logs-'));
  mkdirSync(join(root, '.vibe'));
  return root;
}

describe('daemon log viewer', () => {
  it('shows only the requested recent lines', () => {
    const root = projectRoot();
    try {
      writeFileSync(join(root, '.vibe', 'daemon.log'), 'first\nsecond\nthird\n');
      expect(readRecentDaemonLogs(root, 2)).toBe('second\nthird\n');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('returns an empty result before the daemon creates a log', () => {
    const root = projectRoot();
    try {
      expect(readRecentDaemonLogs(root)).toBe('');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('streams new log lines and Ctrl-C detaches without stopping the daemon', async () => {
    const root = projectRoot();
    const signals = new EventEmitter();
    const output: string[] = [];
    const logPath = join(root, '.vibe', 'daemon.log');
    try {
      writeFileSync(logPath, 'previous\n');
      const following = followDaemonLogs(root, { signals, intervalMs: 10, write: (value) => output.push(value) });
      appendFileSync(logPath, 'new sync\n');
      for (let attempt = 0; attempt < 30 && !output.join('').includes('new sync'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(output.join('')).toContain('previous\n');
      expect(output.join('')).toContain('new sync\n');
      signals.emit('SIGINT');
      await following;
      expect(output.join('')).toContain('后台同步继续运行');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
