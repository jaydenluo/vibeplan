import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

export type ProjectConfig = {
  server: string;
  projectId: string;
  organizationId: string;
  teamId: string;
};

export function projectConfigPath(root = process.cwd()): string {
  return join(root, '.vibe', 'project.yaml');
}

export function loadProjectConfig(root = process.cwd()): ProjectConfig | undefined {
  const path = projectConfigPath(root);
  if (!existsSync(path)) return undefined;
  return parse(readFileSync(path, 'utf8')) as ProjectConfig;
}

export function writeProjectConfig(config: ProjectConfig, root = process.cwd()): void {
  mkdirSync(join(root, '.vibe'), { recursive: true });
  writeFileSync(projectConfigPath(root), stringify(config), 'utf8');
}

export function decideInitAction(local: ProjectConfig | undefined, projectId: string, force = false) {
  if (!local) return { action: 'create' as const };
  if (local.projectId === projectId) return { action: 'sync' as const };
  if (force) return { action: 'replace' as const };
  return { action: 'refuse' as const, reason: 'PROJECT_MISMATCH' as const };
}
