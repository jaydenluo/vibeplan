import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { claudeInstructions } from '@vibeplan/templates';
import { cliVersion } from '../version.js';

const start = '<!-- VIBE PLAN CLAUDE MANAGED START -->';
const end = '<!-- VIBE PLAN CLAUDE MANAGED END -->';

function templateParts() {
  const content = claudeInstructions().trim();
  const version = `${cliVersion}:${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
  return { block: `${start}\n<!-- VIBE PLAN CLAUDE TEMPLATE: ${version} -->\n${content}\n${end}`, version };
}

function managedBlock(content: string): { from: number; to: number; block: string } | undefined {
  const from = content.indexOf(start);
  const last = content.indexOf(end, from + start.length);
  if (from < 0 || last < 0 || content.indexOf(start, from + start.length) >= 0 || content.indexOf(end, last + end.length) >= 0) return undefined;
  return { from, to: last + end.length, block: content.slice(from, last + end.length) };
}

export function claudeInstructionsPath(root = process.cwd()): string {
  return join(root, 'CLAUDE.md');
}

export function managedClaudeTemplate(): string {
  return `${templateParts().block}\n`;
}

export function inspectClaudeInstructions(root = process.cwd()): { state: 'current' | 'missing' | 'different'; templateVersion: string; installedTemplateVersion?: string; legacy?: boolean } {
  const path = claudeInstructionsPath(root);
  const template = templateParts();
  if (!existsSync(path)) return { state: 'missing', templateVersion: template.version };
  const content = readFileSync(path, 'utf8');
  const managed = managedBlock(content);
  return {
    state: managed?.block === template.block ? 'current' : 'different',
    templateVersion: template.version,
    ...(managed ? { installedTemplateVersion: managed.block.match(/VIBE PLAN CLAUDE TEMPLATE: ([^ ]+)/)?.[1] } : { legacy: true }),
  };
}

export function installClaudeInstructions(root = process.cwd(), force = false): string {
  const target = claudeInstructionsPath(root);
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  let content = managedClaudeTemplate();
  if (previous !== undefined) {
    const managed = managedBlock(previous);
    if (managed) content = previous.slice(0, managed.from) + templateParts().block + previous.slice(managed.to);
    else if (previous !== managedClaudeTemplate()) {
      if (!force) throw new Error(`CLAUDE.md already exists with different content: ${target}`);
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      writeFileSync(backup, previous, { encoding: 'utf8', flag: 'wx' });
      console.log(`Backed up existing CLAUDE.md at ${backup}`);
    }
  }
  mkdirSync(root, { recursive: true });
  if (previous !== content) {
    writeFileSync(`${target}.tmp`, content, 'utf8');
    renameSync(`${target}.tmp`, target);
  }
  console.log(`Installed Vibe Plan Claude Code instructions at ${target}`);
  return target;
}
