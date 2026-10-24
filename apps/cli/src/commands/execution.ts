import { readFileSync } from 'node:fs';
import { submitMutation, outboxOrigin } from '../sync/outbox.js';
import { boundTask } from './task-binding.js';

export type Evidence = { label: string; url: string };
export type ReportOptions = {
  changedFiles?: string[];
  tests?: Array<{ command: string; result: string; outcome?: string; exitCode?: number }>;
  commit?: string | null;
  outcome?: 'success' | 'failed' | 'blocked';
  evidence?: Evidence[];
  risks?: string[];
  remainingIssues?: string[];
  criterionResults?: Array<{ acceptanceItemId: string; result: string; evidence: Evidence[] }>;
};
type ReportFlags = { report?: unknown; changedFile?: string[]; test?: string[]; commit?: string; outcome?: string; evidence?: string[]; risk?: string[]; remainingIssue?: string[] };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Report must be a JSON object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Report list fields must be arrays.');
  return value.map(parse);
}
function evidence(value: unknown): Evidence {
  const entry = object(value);
  const url = text(entry.url, 'Evidence URL');
  if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Evidence URL must use HTTP or HTTPS.');
  return { label: text(entry.label, 'Evidence label'), url };
}

export function readReportFile(path: string): { summary?: string; options: ReportOptions } {
  const report = object(JSON.parse(readFileSync(path, 'utf8')));
  return { summary: report.summary === undefined ? undefined : text(report.summary, 'Summary'), options: buildReportOptions({ report }) };
}

export function buildReportOptions(flags: ReportFlags = {}): ReportOptions {
  const report = flags.report === undefined ? {} : object(flags.report);
  const outcome = flags.outcome ?? report.outcome ?? 'success';
  if (!['success', 'failed', 'blocked'].includes(String(outcome))) throw new Error('Outcome must be success, failed or blocked.');
  const tests = flags.test?.map((value) => {
    const split = value.indexOf('=');
    if (split < 1 || split === value.length - 1) throw new Error('Test must be command=result; include the actual result.');
    return { command: value.slice(0, split), result: value.slice(split + 1) };
  }) ?? report.tests;
  return {
    outcome: outcome as ReportOptions['outcome'],
    changedFiles: array(flags.changedFile?.length ? flags.changedFile : report.changedFiles, (value) => text(value, 'Changed file')),
    tests: array(tests, (value) => {
      const item = object(value);
      if (item.outcome !== undefined && !['passed', 'failed', 'skipped', 'not_run'].includes(String(item.outcome))) throw new Error('Invalid test outcome.');
      if (item.exitCode !== undefined && !Number.isInteger(item.exitCode)) throw new Error('Test exitCode must be an integer.');
      return { command: text(item.command, 'Test command'), result: text(item.result, 'Test result'), ...(item.outcome === undefined ? {} : { outcome: String(item.outcome) }), ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode as number }) };
    }),
    commit: flags.commit ?? (report.commit == null ? null : text(report.commit, 'Commit')),
    evidence: [...array(report.evidence, evidence), ...(flags.evidence ?? []).map((url) => evidence({ label: url, url }))],
    risks: [...array(report.risks, (value) => text(value, 'Risk')), ...(flags.risk ?? []).map((value) => text(value, 'Risk'))],
    remainingIssues: [...array(report.remainingIssues, (value) => text(value, 'Remaining issue')), ...(flags.remainingIssue ?? []).map((value) => text(value, 'Remaining issue'))],
    criterionResults: array(report.criterionResults, (value) => { const item = object(value); return { acceptanceItemId: text(item.acceptanceItemId, 'Acceptance item ID'), result: text(item.result, 'Criterion result'), evidence: array(item.evidence, evidence) }; }),
  };
}

export function validateTaskVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1) throw new Error('Task version must be a positive integer.');
}

export function buildProgressPatch(progress: number, stage: string, summary: string): Record<string, unknown> {
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('Progress must be an integer between 0 and 100.');
  if (!['analysis', 'implementation', 'testing', 'blocked', 'ready_for_review'].includes(stage)) throw new Error('Invalid execution stage.');
  return { progress, executionStage: stage, executionNote: text(summary, 'Progress summary'), ...(stage === 'blocked' ? { status: 'blocked' } : {}) };
}

async function updateExecution(id: string, version: number, patch: Record<string, unknown>): Promise<void> {
  validateTaskVersion(version);
  const { client, item, session } = await boundTask(id);
  if (item.version !== version) throw new Error('Task version changed. Reread task:context and compare before retrying.');
  console.log(JSON.stringify(await submitMutation({ type: 'work-item.update', payload: { id, version, patch }, origin: outboxOrigin(session) }, (event) => client.updateWorkItem(id, version, patch, event.id)), null, 2));
}

export async function uploadTaskPlan(id: string, version: number, planMarkdown: string): Promise<void> {
  await updateExecution(id, version, { planMarkdown: text(planMarkdown, 'Plan Markdown') });
}
export async function updateTaskProgress(id: string, version: number, progress: number, stage: string, summary: string): Promise<void> {
  await updateExecution(id, version, buildProgressPatch(progress, stage, summary));
}
