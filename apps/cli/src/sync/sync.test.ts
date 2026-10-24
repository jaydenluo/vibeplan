import { existsSync, mkdtempSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTaskMirror } from './task-mirror.js';
import { enqueueOutbox, listOutbox, removeOutbox } from './outbox.js';

describe('local task sync', () => {
  it('rejects a directory at the mirror target without leaving temporary files', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-mirror-failure-'));
    const tasks = join(root, '.vibe', 'tasks');
    mkdirSync(join(tasks, 'failure.md'), { recursive: true });
    expect(() => writeTaskMirror({ id: 'failure', title: 'Failure', type: 'feature', status: 'ready', priority: 'P2', version: 1 }, root)).toThrow();
    expect(readdirSync(tasks)).toEqual(['failure.md']);
  });
  it('writes a readable Markdown task mirror with version metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-plan-'));
    const path = writeTaskMirror({ id: 'task-1', title: '实现同步', status: 'ready', priority: 'P1', type: 'feature', version: 2, progress: 55, dueDate: '2026-10-20', estimate: 3, description: '同步任务。', planMarkdown: '# 计划\n\n- 实现同步', acceptanceCriteria: ['状态可见'] }, root);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('id: task-1');
    expect(content).toContain('version: 2');
    expect(content).toContain('progress: 55');
    expect(content).toContain('- 状态可见');
    expect(existsSync(join(root, '.vibe', 'tasks', 'task-1.plan.md'))).toBe(true);
    expect(readFileSync(join(root, '.vibe', 'tasks', 'task-1.plan.md'), 'utf8')).toContain('# 计划');
  });

  it('queues and removes an outbox event atomically', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-plan-'));
    const event = enqueueOutbox({ type: 'work-item.update', payload: { id: 'task-1', version: 2 } }, root);
    expect(listOutbox(root)).toHaveLength(1);
    expect(listOutbox(root)[0].id).toBe(event.id);
    removeOutbox(event.id, root);
    expect(listOutbox(root)).toHaveLength(0);
  });

  it('preserves failure context in a local task mirror for a new session', () => {
    const root = mkdtempSync(join(tmpdir(), 'vibe-plan-'));
    const path = writeTaskMirror({ id: 'recovery', title: 'Recover tests', status: 'in_progress', priority: 'P1', type: 'feature', version: 3, executionStage: 'testing', executionNote: 'Repair concurrency', executionReport: { outcome: 'failed', summary: 'Tests failed', tests: [{ command: 'test', result: 'exit code 1' }], remainingIssues: ['Retry after repair'] } }, root);
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('testing');
    expect(content).toContain('exit code 1');
    expect(content).toContain('Retry after repair');
  });
});
