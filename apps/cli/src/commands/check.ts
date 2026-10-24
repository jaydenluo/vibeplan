import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectStatus, renderStatus, type StatusDependencies } from './status.js';

export function checkProject(root = process.cwd()): void {
  const vibeDir = join(root, '.vibe');
  if (!existsSync(join(vibeDir, 'project.yaml'))) throw new Error('Missing .vibe/project.yaml. Run vibeplan init first.');
  const tasksDir = join(vibeDir, 'tasks');
  if (existsSync(tasksDir)) {
    for (const file of readdirSync(tasksDir)) {
      if (!file.endsWith('.md')) throw new Error(`Unsupported task file: ${file}`);
    }
  }
  console.log('Vibe Plan checks passed.');
}
export async function checkWithStatus(root: string, dependencies: StatusDependencies): Promise<void> {
  checkProject(root);
  console.log(renderStatus(await collectStatus(root, dependencies), true));
}
