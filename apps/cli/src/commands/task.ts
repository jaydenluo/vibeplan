import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { ApiClient } from '../api-client.js';
import { submitMutation, outboxOrigin } from '../sync/outbox.js';
import { buildReportOptions, validateTaskVersion, type ReportOptions } from './execution.js';

function context() {
  const config = loadProjectConfig();
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  return config;
}

export async function listTasks(): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = context();
  const items = await new ApiClient(session.server, session).workItems(config.projectId);
  console.log(JSON.stringify(items, null, 2));
}

export async function startTask(id: string, version: number): Promise<void> {
  validateTaskVersion(version);
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const patch = { status: 'in_progress' };
  console.log(JSON.stringify(await submitMutation({ type: 'work-item.update', payload: { id, version, patch }, origin: outboxOrigin(session) }, (event) => new ApiClient(session.server, session).updateWorkItem(id, version, patch, event.id)), null, 2));
}

export async function reportTask(id: string, version: number, summary: string, options: ReportOptions = {}): Promise<void> {
  validateTaskVersion(version);
  if (!summary?.trim()) throw new Error('Report summary is required.');
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const payload = { ...buildReportOptions({ report: options }), version, summary };
  console.log(JSON.stringify(await submitMutation({ type: 'work-item.report', payload: { id, report: payload }, origin: outboxOrigin(session) }, (event) => new ApiClient(session.server, session).reportWorkItem(id, payload, event.id)), null, 2));
}

export async function acceptTask(id: string, version: number, decision: 'approved' | 'rejected', comment?: string): Promise<void> {
  validateTaskVersion(version);
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const payload = { version, decision, ...(comment ? { comment } : {}) };
  console.log(JSON.stringify(await submitMutation({ type: 'work-item.accept', payload: { id, acceptance: payload }, origin: outboxOrigin(session) }, (event) => new ApiClient(session.server, session).acceptWorkItem(id, payload, event.id)), null, 2));
}

export async function logTask(id: string, hours: number, content: string, date?: string): Promise<void> {
  if (!Number.isFinite(hours) || hours <= 0 || !content.trim()) throw new Error('Work log requires positive hours and content.');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) throw new Error('Work log date must be YYYY-MM-DD.');
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const input = { hours, content, workDate: date ?? new Date().toISOString().slice(0, 10) };
  console.log(JSON.stringify(await submitMutation({ type: 'work-item.log', payload: { id, log: input }, origin: outboxOrigin(session) }, (event) => new ApiClient(session.server, session).logWorkItem(id, input, event.id)), null, 2));
}

export async function correctTaskLog(id: string, logId: string, version: number, reason: string, patch: Record<string, unknown>, withdraw = false): Promise<void> {
  validateTaskVersion(version);
  if (!reason.trim()) throw new Error('A work-log correction reason is required.');
  if (patch.hours !== undefined && (!Number.isFinite(patch.hours) || Number(patch.hours) <= 0)) throw new Error('Hours must be positive.');
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const input = { ...patch, version, reason };
  const client = new ApiClient(session.server, session);
  const type = withdraw ? 'work-item.log.withdraw' : 'work-item.log.correct';
  console.log(JSON.stringify(await submitMutation({ type, payload: { id, logId, log: input }, origin: outboxOrigin(session) }, (event) => withdraw ? client.withdrawWorkLog(id, logId, input, event.id) : client.correctWorkLog(id, logId, input, event.id)), null, 2));
}
