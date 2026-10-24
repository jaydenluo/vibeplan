import { describe, expect, it } from 'vitest';
import { agentsInstructions, claudeInstructions, codexSkillInstructions, projectInstructions } from './index.js';

describe('Codex templates', () => {
  it('uses the real CLI command syntax and confirmation protocol', () => {
    const text = `${agentsInstructions()}${projectInstructions()}${codexSkillInstructions()}`;
    expect(text).toContain('vibeplan task:create');
    expect(text).toContain('vibeplan task:show ID');
    expect(text).toContain('vibeplan task:start ID --version VERSION');
    expect(text).toContain('explicit confirmation');
  });

  it('directly drafts task plans without asking for missing planning fields', () => {
    const text = `${projectInstructions()}${codexSkillInstructions()}`;
    expect(text).toContain('Do not ask planning questions');
    expect(text).toContain('Leave the due date empty when no schedule is stated');
  });

  it('directs unbound local projects to create or select a cloud project before creating tasks', () => {
    const text = `${projectInstructions()}${codexSkillInstructions()}`;
    expect(text).toContain('https://vibeplan.szxinjin.cn/projects');
    expect(text).toContain('vibeplan init --project-id PROJECT_ID');
    expect(text).toContain('do not run `vibeplan task:create` until the directory is bound');
    expect(text).toContain('Binding does not create the cloud project again');
  });

  it('provides a Claude Code workflow without requiring Codex-specific installation', () => {
    const text = claudeInstructions();
    expect(text).toContain('Claude Code');
    expect(text).toContain('vibeplan task:show ID');
    expect(text).toContain('vibeplan task:report');
    expect(text).not.toContain('install-codex');
  });
});
