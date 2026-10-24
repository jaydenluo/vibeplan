import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { codexSkillInstructions } from '@vibeplan/templates';
import { cliVersion } from '../version.js';

const start = '<!-- VIBE PLAN SKILL MANAGED START -->';
const end = '<!-- VIBE PLAN SKILL MANAGED END -->';
function templateParts() {
  const content = codexSkillInstructions();
  const header = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0];
  if (!header) throw new Error('Codex Skill template requires leading YAML frontmatter.');
  const version = `${cliVersion}:${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
  const block = `${start}\n<!-- VIBE PLAN SKILL TEMPLATE: ${version} -->\n${content.slice(header.length).trim()}\n${end}`;
  return { header, block, version };
}
function managedBlock(content: string): { from: number; to: number; block: string } | undefined {
  const from = content.indexOf(start);
  const last = content.indexOf(end, from + start.length);
  if (from < 0 || last < 0 || content.indexOf(start, from + start.length) >= 0 || content.indexOf(end, last + end.length) >= 0) return undefined;
  const to = last + end.length;
  return { from, to, block: content.slice(from, to) };
}
export function managedSkillTemplate(): string {
  const { header, block } = templateParts();
  return `${header}\n${block}\n`;
}
export function inspectCodexSkill(codexHome?: string): { state: 'current' | 'missing' | 'different'; templateVersion: string; installedTemplateVersion?: string; legacy?: boolean } {
  const path = codexSkillPath(codexHome);
  const template = templateParts();
  if (!existsSync(path)) return { state: 'missing', templateVersion: template.version };
  const content = readFileSync(path, 'utf8');
  const managed = managedBlock(content);
  return { state: managed ? managed.block === template.block ? 'current' : 'different' : content === codexSkillInstructions() ? 'current' : 'different', templateVersion: template.version, ...(managed ? { installedTemplateVersion: managed.block.match(/VIBE PLAN SKILL TEMPLATE: ([^ ]+)/)?.[1] } : { legacy: true }) };
}

export function codexSkillPath(codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex')) {
  return join(codexHome, 'skills', 'vibe-plan', 'SKILL.md');
}

export function installCodexSkill(codexHome?: string, force = false): string {
  const target = codexSkillPath(codexHome);
  let content = managedSkillTemplate();
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  if (previous !== undefined) {
    const managed = managedBlock(previous);
    if (managed) content = previous.slice(0, managed.from) + templateParts().block + previous.slice(managed.to);
    else if (previous !== codexSkillInstructions()) {
      if (!force) throw new Error(`Codex Skill already exists with different content: ${target}`);
      const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      writeFileSync(backup, previous, { encoding: 'utf8', flag: 'wx' });
      console.log(`Backed up legacy Codex Skill at ${backup}`);
    }
  }
  mkdirSync(join(target, '..'), { recursive: true });
  if (previous !== content) { writeFileSync(`${target}.tmp`, content, 'utf8'); renameSync(`${target}.tmp`, target); }
  console.log(`Installed Vibe Plan Codex Skill at ${target}`);
  return target;
}
