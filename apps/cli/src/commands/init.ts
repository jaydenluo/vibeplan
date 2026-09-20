import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectConfig, decideInitAction, writeProjectConfig, type ProjectConfig } from '../config.js';
import { ApiClient } from '../api-client.js';
import { loadSession } from '../auth.js';
import { agentsInstructions, projectInstructions } from '@vibe/templates';

export async function initProject(projectId: string, force = false, root = process.cwd()): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in. Run `vibe login --server URL` first.');
  const local = loadProjectConfig(root);
  const action = decideInitAction(local, projectId, force);
  if (action.action === 'refuse') throw new Error('This directory is already bound to another project. Use --force to replace it.');
  if (action.action === 'replace' && existsSync(join(root, '.vibe'))) {
    const backup = join(root, '.vibe.backup', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(join(root, '.vibe.backup'), { recursive: true });
    cpSync(join(root, '.vibe'), backup, { recursive: true });
  }
  const project = await new ApiClient(session.server, session).project(projectId);
  const config: ProjectConfig = { server: session.server, projectId: project.id, teamId: project.teamId, organizationId: local?.organizationId ?? 'unknown' };
  writeProjectConfig(config, root);
  mkdirSync(join(root, '.vibe', 'tasks'), { recursive: true });
  mkdirSync(join(root, '.vibe', 'cache'), { recursive: true });
  writeFileSync(join(root, 'AGENTS.md'), agentsInstructions(), 'utf8');
  writeFileSync(join(root, '.vibe', 'instructions.md'), projectInstructions(), 'utf8');
  console.log(`Initialized Vibe Plan project ${project.id}.`);
}
