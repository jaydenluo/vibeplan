import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function checkProject(root = process.cwd()): void {
  const vibeDir = join(root, '.vibe');
  if (!existsSync(join(vibeDir, 'project.yaml'))) throw new Error('Missing .vibe/project.yaml. Run vibe init first.');
  const tasksDir = join(vibeDir, 'tasks');
  if (existsSync(tasksDir)) {
    for (const file of readdirSync(tasksDir)) {
      if (!file.endsWith('.md')) throw new Error(`Unsupported task file: ${file}`);
    }
  }
  console.log('Vibe Plan checks passed.');
}
