import { existsSync, readFileSync, readdirSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export type TaskMirror = {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  progress?: number | null;
  version: number;
  dueDate?: string | null;
  estimate?: number | null;
  description?: string | null;
  planMarkdown?: string | null;
  acceptanceCriteria?: string[];
  executionStage?: string | null;
  executionNote?: string | null;
  executionReport?: Record<string, unknown> | null;
};

function markdown(task: TaskMirror): string {
  const criteria = task.acceptanceCriteria ?? [];
  return `---\nid: ${task.id}\nversion: ${task.version}\ntype: ${task.type}\nstatus: ${task.status}\npriority: ${task.priority}\nprogress: ${task.progress ?? (task.status === 'done' ? 100 : 0)}\ndueDate: ${task.dueDate ?? ''}\nestimate: ${task.estimate ?? ''}\n---\n\n# ${task.title}\n\n${task.description ?? ''}\n\n## 验收标准\n\n${criteria.length ? criteria.map((criterion) => `- ${criterion}`).join('\n') : '- 暂无验收标准'}\n`;
}

export function writeTaskMirror(task: TaskMirror, root = process.cwd()): string {
  validateId(task.id);
  const directory = join(root, '.vibe', 'tasks');
  const target = join(directory, `${task.id}.md`);
  mkdirSync(directory, { recursive: true });
  const context = `\n## 执行上下文 / Execution context\n\n阶段 / Stage: ${task.executionStage ?? '未记录'}\n\n${task.executionNote ?? ''}\n\n${task.executionReport ? '```json\n' + JSON.stringify(task.executionReport, null, 2) + '\n```\n' : '暂无执行报告 / No execution report.\n'}`;
  writeChanged(target, markdown(task) + context);
  const planTarget = join(directory, `${task.id}.plan.md`);
  writeChanged(planTarget, task.planMarkdown ?? `# ${task.title}\n\n暂无详细计划。\n`);
  return target;
}
function validateId(id: string) { if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid task mirror ID.'); }
function writeChanged(target: string, content: string) {
  if (existsSync(target) && readFileSync(target, 'utf8') === content) return;
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' }); renameSync(temporary, target); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export function archiveTaskMirror(id: string, root = process.cwd()): void {
  validateId(id);
  const directory = join(root, '.vibe', 'tasks');
  const task = join(directory, `${id}.md`);
  if (!existsSync(task) || !readFileSync(task, 'utf8').startsWith(`---\nid: ${id}\nversion: `)) return;
  const archive = join(root, '.vibe', 'archive');
  mkdirSync(archive, { recursive: true });
  for (const suffix of ['.md', '.plan.md']) {
    const source = join(directory, `${id}${suffix}`);
    if (existsSync(source)) renameSync(source, join(archive, `${id}${suffix}`));
  }
}
export function managedMirrorIds(root = process.cwd()): string[] {
  const directory = join(root, '.vibe', 'tasks');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => /^[a-zA-Z0-9_-]+\.md$/.test(name)).flatMap((name) => {
    const id = name.slice(0, -3);
    return readFileSync(join(directory, name), 'utf8').startsWith(`---\nid: ${id}\nversion: `) ? [id] : [];
  });
}
