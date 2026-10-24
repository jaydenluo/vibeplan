import { createHash } from 'node:crypto';

export type BatchTask = {
  id: string; projectId: string; title: string; description?: string; status: string; version: number;
  parentId?: string | null; dependsOn?: string[]; planMarkdown?: string | null;
  acceptanceItems: Array<{ id: string; text: string; required: boolean }>;
  [key: string]: unknown;
};
export type BatchPlan = {
  format: 1; projectId: string; server: string; actorId: string;
  tasks: Array<{ snapshot: BatchTask; scope: string; checks: string[][] }>;
  integrationChecks: string[][]; maxAttempts: number; timeoutMinutes: number;
};
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function taskScope(task: BatchTask): string {
  return hash([task.id, task.projectId, task.title, task.description ?? '', task.type ?? null, task.priority ?? null,
    task.parentId ?? null, task.dependsOn ?? [], task.planMarkdown ?? '',
    task.acceptanceItems.map(({ id, text, required }) => ({ id, text, required }))]);
}
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function checkArgv(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || value.some((part) => typeof part !== 'string' || !part.trim() || part.includes('\0') || part.length > 4000)) throw new Error('Check argv must be a nonempty JSON array of strings.');
}
export function makePlan(binding: { projectId: string; server: string; actorId: string }, items: BatchTask[], ids: string[] = [], checks: string[][] = []): BatchPlan {
  const parents = new Set(items.map((t) => t.parentId).filter(Boolean));
  const selected = ids.length ? [...new Set(ids)].map((id) => {
    const task = items.find((t) => t.id === id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    if (parents.has(id)) throw new Error(`Select leaf tasks, not parent containers: ${task.title}`);
    return task;
  }) : items.filter((t) => !parents.has(t.id) && !['done', 'cancelled', 'in_review'].includes(t.status));
  if (!selected.length) throw new Error('No executable leaf tasks selected.');
  const plan: BatchPlan = { format: 1, ...binding, tasks: selected.map((snapshot) => ({ snapshot, scope: taskScope(snapshot), checks: checks.map((argv) => [...argv]) })), integrationChecks: checks.map((argv) => [...argv]), maxAttempts: 2, timeoutMinutes: 30 };
  executionOrder(plan);
  return plan;
}
export function executionOrder(plan: BatchPlan): BatchTask[] {
  const tasks = new Map(plan.tasks.map((t) => [t.snapshot.id, t.snapshot]));
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: BatchTask[] = [];
  function visit(task: BatchTask) {
    if (visiting.has(task.id)) throw new Error('Task dependency cycle detected.');
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const id of task.dependsOn ?? []) { const prerequisite = tasks.get(id); if (prerequisite) visit(prerequisite); }
    visiting.delete(task.id); visited.add(task.id); ordered.push(task);
  }
  for (const task of tasks.values()) visit(task);
  return ordered;
}
export function validatePlan(value: unknown): BatchPlan {
  const plan = value as BatchPlan;
  if (!plan || plan.format !== 1 || !uuid.test(plan.projectId) || !uuid.test(plan.actorId) || typeof plan.server !== 'string' || !/^https?:\/\//.test(plan.server)) throw new Error('Invalid batch binding or format.');
  if (!Number.isInteger(plan.maxAttempts) || plan.maxAttempts < 1 || plan.maxAttempts > 3 || !Number.isFinite(plan.timeoutMinutes) || plan.timeoutMinutes < 1 || plan.timeoutMinutes > 120) throw new Error('Attempts must be 1–3 and timeoutMinutes 1–120.');
  if (!Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 100 || !Array.isArray(plan.integrationChecks) || !plan.integrationChecks.length) throw new Error('Select 1–100 tasks and configure integration checks.');
  const ids = new Set<string>();
  for (const entry of plan.tasks) {
    const t = entry.snapshot;
    if (!t || !uuid.test(t.id) || t.projectId !== plan.projectId || ids.has(t.id) || !Number.isInteger(t.version) || t.version < 1 || !['backlog', 'ready', 'in_progress', 'blocked'].includes(t.status)) throw new Error('Invalid, duplicate, terminal or review task snapshot.');
    ids.add(t.id);
    if (typeof t.planMarkdown !== 'string' || !t.planMarkdown.trim() || !Array.isArray(t.acceptanceItems) || !t.acceptanceItems.length || !t.acceptanceItems.every((c) => c.id && c.text?.trim() && typeof c.required === 'boolean')) throw new Error(`Detailed plan and acceptance criteria required: ${t.title}`);
    if (t.dependsOn !== undefined && (!Array.isArray(t.dependsOn) || !t.dependsOn.every((id) => typeof id === 'string' && uuid.test(id)))) throw new Error('Invalid dependencies.');
    if (taskScope(t) !== entry.scope) throw new Error(`Snapshot scope changed: ${t.title}. Prepare a fresh plan.`);
    if (!Array.isArray(entry.checks) || !entry.checks.length || entry.checks.length > 50) throw new Error(`Configure at least one task check: ${t.title}`);
    entry.checks.forEach(checkArgv);
  }
  if (plan.integrationChecks.length > 50) throw new Error('Too many integration checks.');
  plan.integrationChecks.forEach(checkArgv);
  executionOrder(plan);
  return plan;
}
