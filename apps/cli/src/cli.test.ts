import { describe, expect, it } from 'vitest';
import { decideInitAction, type ProjectConfig } from './config.js';

describe('vibe init', () => {
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
