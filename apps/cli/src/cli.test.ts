import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decideInitAction, type ProjectConfig } from './config.js';
import { buildTaskCreatePayload, type TaskCreateOptions } from './commands/task-create.js';
import { mergeAgentsInstructions } from './commands/init.js';
import { ApiClient, ApiRequestError, normalizeServer } from './api-client.js';
import { cliErrorMessage } from './errors.js';
import { codexSkillPath, installCodexSkill, managedSkillTemplate } from './commands/install-codex.js';
import { codexSkillInstructions } from '@vibeplan/templates';
import { cliVersion } from './version.js';
import { normalizeTaskVersionOption } from './command-args.js';

describe('vibeplan init', () => {
  it('creates a project when no local config exists', () => {
    expect(decideInitAction(undefined, 'proj_123')).toEqual({ action: 'create' });
  });

  it('syncs when the local project id matches', () => {
    const config: ProjectConfig = { server: 'https://vibe.test', projectId: 'proj_123', organizationId: 'org_1', teamId: 'team_1' };
    expect(decideInitAction(config, 'proj_123')).toEqual({ action: 'sync' });
  });

  it('refuses to overwrite a different project without force', () => {
    const config: ProjectConfig = { server: 'https://vibe.test', projectId: 'proj_old', organizationId: 'org_1', teamId: 'team_1' };
    expect(decideInitAction(config, 'proj_new')).toEqual({ action: 'refuse', reason: 'PROJECT_MISMATCH' });
    expect(decideInitAction(config, 'proj_new', true)).toEqual({ action: 'replace' });
  });
});

describe('CLI version', () => {
  it('reads the published package version', () => {
    expect(cliVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps task command versions separate from the CLI version flag', () => {
    expect(normalizeTaskVersionOption(['node', 'vibeplan', 'task:report', 'task-1', '--version', '3'])).toEqual(['node', 'vibeplan', 'task:report', 'task-1', '--task-version', '3']);
    expect(normalizeTaskVersionOption(['node', 'vibeplan', '--version'])).toEqual(['node', 'vibeplan', '--version']);
  });
});

describe('CLI command name', () => {
  it('publishes vibeplan as the only executable', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { bin: Record<string, string> };
    expect(packageJson.bin.vibeplan).toBe('dist/index.js');
    expect(packageJson.bin.vibe).toBeUndefined();
  });

  it('registers Claude Code installation as a public CLI command', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain("'install-claude'");
    expect(source).toContain("program.command('install-claude')");
  });
});

describe('server URL', () => {
  it('adds the API prefix for a deployed web domain', () => {
    expect(normalizeServer('https://vibeplan.szxinjin.cn')).toBe('https://vibeplan.szxinjin.cn/api');
  });

  it('keeps the local API URL unchanged', () => {
    expect(normalizeServer('http://localhost:4000/')).toBe('http://localhost:4000');
  });

  it('preserves an explicitly configured path', () => {
    expect(normalizeServer('https://example.com/api/')).toBe('https://example.com/api');
  });

  it('does not send a JSON content type for empty POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ deviceCode: 'device', userCode: '123456', expiresInSeconds: 600 }) });
    vi.stubGlobal('fetch', fetchMock);
    await new ApiClient('https://example.com/api').startDevice();
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/api/auth/device/start', expect.objectContaining({
      method: 'POST',
      headers: {},
    }));
    vi.unstubAllGlobals();
  });
});

describe('CLI error messages', () => {
  it('explains when the server cannot be reached', () => {
    expect(cliErrorMessage(new TypeError('fetch failed'))).toContain('无法连接 Vibe Plan 服务端');
    expect(cliErrorMessage(new TypeError('fetch failed'))).toContain('vibeplan status');
  });

  it('explains when the server returns an internal error', () => {
    const message = cliErrorMessage(new ApiRequestError(500, 'Internal server error.'));
    expect(message).toContain('Vibe Plan 服务端暂时不可用');
    expect(message).toContain('HTTP 500');
  });
});

describe('task create', () => {
  it('normalizes the standard planning fields into an API payload', () => {
    const options: TaskCreateOptions = {
      title: '实现任务同步',
      type: 'feature',
      status: 'backlog',
      priority: 'P1',
      dueDate: '2026-10-20',
      estimate: '3',
      description: '同步任务状态。',
      acceptance: ['状态可实时显示', '失败可重试'],
    };
    expect(buildTaskCreatePayload(options)).toEqual({
      title: '实现任务同步',
      type: 'feature',
      status: 'backlog',
      priority: 'P1',
      dueDate: '2026-10-20',
      estimate: 3,
      description: '同步任务状态。',
      acceptanceCriteria: ['状态可实时显示', '失败可重试'],
    });
  });

  it('keeps the due date empty for an unscheduled plan task', () => {
    const options = {
      title: '梳理同步方案',
      type: 'feature',
      status: 'backlog',
      priority: 'P2',
      estimate: '2',
      description: '整理本次同步方案。',
      acceptance: ['形成可执行计划'],
    } as TaskCreateOptions;
    expect(buildTaskCreatePayload(options)).toMatchObject({ dueDate: null });
  });
});

describe('AGENTS.md integration', () => {
  it('preserves user instructions while adding a managed Vibe Plan block', () => {
    const merged = mergeAgentsInstructions('# Team rules\n\nAlways run the test suite.\n');
    expect(merged).toContain('# Team rules');
    expect(merged).toContain('Always run the test suite.');
    expect(merged).toContain('<!-- VIBE PLAN MANAGED START -->');
    expect(merged).toContain('.vibe/instructions.md');
  });

  it('updates the managed block without duplicating it', () => {
    const first = mergeAgentsInstructions('# Team rules\n');
    const second = mergeAgentsInstructions(first);
    expect(second.match(/VIBE PLAN MANAGED START/g)).toHaveLength(1);
    expect(second).toContain('# Team rules');
  });
});

describe('Codex Skill installation', () => {
  it('requires force before replacing an existing Skill and replaces it when requested', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'vibe-plan-skill-'));
    const target = codexSkillPath(codexHome);
    try {
      installCodexSkill(codexHome);
      writeFileSync(target, 'user-customized skill', 'utf8');

      expect(() => installCodexSkill(codexHome)).toThrow('already exists with different content');
      expect(installCodexSkill(codexHome, true)).toBe(target);
      expect(readFileSync(target, 'utf8')).toBe(managedSkillTemplate());
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});
