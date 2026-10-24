import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { checkWithStatus } from './check.js';
import type { StatusDependencies } from './status.js';
it('prints CLI, server, Skill, daemon and sync diagnostics without changing local check semantics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-check-'));
  mkdirSync(join(root, '.vibe')); writeFileSync(join(root, '.vibe', 'project.yaml'), 'projectId: project');
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  const dependencies: StatusDependencies = { cliVersion: '1.2.3', loadSession: async () => ({ server: 'https://example.test/api', accessToken: 'token', refreshToken: 'refresh' }), createClient: () => ({ me: async () => ({ id: 'actor', email: 'actor@example.test' }), workItems: async () => [], serverInfo: async () => ({ version: '4.5.6', protocolVersion: 1, capabilities: ['sync-feed'] }) }), loadProjectConfig: () => ({ projectId: 'project', teamId: 'team', organizationId: 'org', server: 'https://example.test/api' }), daemonStatus: () => ({ running: false }), listOutbox: () => [], gitState: () => undefined, lastLogUpdatedAt: () => undefined };
  await checkWithStatus(root, dependencies);
  const text = output.mock.calls.flat().join('\n');
  expect(text).toContain('checks passed');
  for (const expected of ['1.2.3', '4.5.6', 'sync-feed', 'Skill', 'Daemon', '同步状态']) expect(text).toContain(expected);
  vi.restoreAllMocks();
  await expect(checkWithStatus(mkdtempSync(join(tmpdir(), 'vibe-unbound-')), dependencies)).rejects.toThrow('Missing .vibe/project.yaml');
});
