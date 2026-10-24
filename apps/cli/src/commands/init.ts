import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectConfig, decideInitAction, writeProjectConfig, type ProjectConfig } from '../config.js';
import { ApiClient } from '../api-client.js';
import { loadSession } from '../auth.js';
import { agentsInstructions, projectInstructions } from '@vibeplan/templates';

const managedStart = '<!-- VIBE PLAN MANAGED START -->';
const managedEnd = '<!-- VIBE PLAN MANAGED END -->';

export function mergeAgentsInstructions(existing: string | undefined): string {
  const template = agentsInstructions().trim();
  const body = template.replace(/^# AGENTS\.md\s*/i, '').trim();
  const managedBlock = `${managedStart}\n${body}\n${managedEnd}`;
  if (!existing?.trim()) return `# AGENTS.md\n\n${managedBlock}\n`;

  const blockPattern = new RegExp(`${managedStart}[\\s\\S]*?${managedEnd}\\n?`, 'm');
  if (blockPattern.test(existing)) {
    return existing.replace(blockPattern, `${managedBlock}\n`).replace(/\n{3,}$/g, '\n\n');
  }
  if (existing.trim() === template) return `# AGENTS.md\n\n${managedBlock}\n`;
  return `${existing.trimEnd()}\n\n${managedBlock}\n`;
}

export async function initProject(projectId: string, force = false, root = process.cwd()): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in. Run `vibeplan login --server URL` first.');
  const local = loadProjectConfig(root);
  const action = decideInitAction(local, projectId, force);
  if (action.action === 'refuse') throw new Error('This directory is already bound to another project. Use --force to replace it.');
  if (action.action === 'replace' && existsSync(join(root, '.vibe'))) {
    const backup = join(root, '.vibe.backup', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(join(root, '.vibe.backup'), { recursive: true });
    cpSync(join(root, '.vibe'), backup, { recursive: true });
  }
  const project = await new ApiClient(session.server, session).project(projectId);
  const config: ProjectConfig = { server: session.server, projectId: project.id, teamId: project.teamId, organizationId: project.organizationId };
  writeProjectConfig(config, root);
  mkdirSync(join(root, '.vibe', 'tasks'), { recursive: true });
  mkdirSync(join(root, '.vibe', 'cache'), { recursive: true });
  const agentsPath = join(root, 'AGENTS.md');
  const existingAgents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : undefined;
  writeFileSync(agentsPath, mergeAgentsInstructions(existingAgents), 'utf8');
  writeFileSync(join(root, '.vibe', 'instructions.md'), projectInstructions(), 'utf8');
  console.log(`Initialized Vibe Plan project ${project.id}.`);
}
