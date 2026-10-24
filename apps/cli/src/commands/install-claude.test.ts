import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { claudeInstructions } from '@vibeplan/templates';
import { installClaudeInstructions, managedClaudeTemplate } from './install-claude.js';

describe('Claude Code project instructions', () => {
  it('creates a managed CLAUDE.md and preserves custom content during upgrades', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibeplan-claude-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const path = installClaudeInstructions(root);
      expect(readFileSync(path, 'utf8')).toContain('<!-- VIBE PLAN CLAUDE MANAGED START -->');
      const custom = '\n## Local rules\nAlways run the integration tests.\n';
      writeFileSync(path, readFileSync(path, 'utf8') + custom, 'utf8');
      installClaudeInstructions(root);
      expect(readFileSync(path, 'utf8')).toContain(custom);
      expect(readFileSync(path, 'utf8')).toContain('Claude Code');
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires force and backs up an unmarked CLAUDE.md before migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibeplan-claude-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const path = join(root, 'CLAUDE.md');
      writeFileSync(path, 'Existing project instructions\n', 'utf8');
      expect(() => installClaudeInstructions(root)).toThrow('already exists with different content');
      installClaudeInstructions(root, true);
      const backup = readdirSync(root).find((name) => name.startsWith('CLAUDE.md.backup-'));
      expect(backup).toBeTruthy();
      expect(readFileSync(join(root, backup!), 'utf8')).toBe('Existing project instructions\n');
      expect(readFileSync(path, 'utf8')).toBe(managedClaudeTemplate());
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes the cloud binding and task execution workflow', () => {
    const text = claudeInstructions();
    expect(text).toContain('https://vibeplan.szxinjin.cn/projects');
    expect(text).toContain('vibeplan init --project-id PROJECT_ID');
    expect(text).toContain('vibeplan task:report');
    expect(text).toContain('Do not ask planning questions');
  });
});
