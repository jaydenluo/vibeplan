import { expect, it } from 'vitest';
import { makePlan, taskScope, validatePlan, executionOrder, type BatchTask } from './plan.js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = (n: number, extra = {}): BatchTask => ({ id: id(n), projectId: id(99), title: `Task ${n}`, description: 'Build', status: 'backlog', version: 1, dependsOn: [], planMarkdown: '# Detailed plan', acceptanceItems: [{ id: `criterion-${n}`, text: 'Works', required: true }], ...extra });
const binding = { projectId: id(99), server: 'https://example.com/api', actorId: id(98) };
it('selects unfinished leaves and orders prerequisites before their dependents', () => {
  const plan = makePlan(binding, [task(2, { dependsOn: [id(1)] }), task(1), task(3, { status: 'done' }), task(4), task(5, { parentId: id(4) })], [], [['npm', 'test']]);
  expect(executionOrder(plan).map((t) => t.id)).toEqual([id(1), id(2), id(5)]);
});
it('refuses cycles and explicit nonleaf/unknown selections', () => {
  expect(() => makePlan(binding, [task(1, { dependsOn: [id(2)] }), task(2, { dependsOn: [id(1)] })], [], [['npm', 'test']])).toThrow('cycle');
  expect(() => makePlan(binding, [task(1), task(2, { parentId: id(1) })], [id(1)], [])).toThrow('leaf');
  expect(() => makePlan(binding, [task(1)], [id(9)], [])).toThrow('Unknown');
});
it('freezes scope independently from routine progress, but includes plan and criteria changes', () => {
  expect(taskScope(task(1))).toBe(taskScope(task(1, { version: 8, status: 'in_progress', progress: 40 })));
  expect(taskScope(task(1))).not.toBe(taskScope(task(1, { planMarkdown: 'Different' })));
  expect(taskScope(task(1))).not.toBe(taskScope(task(1, { acceptanceItems: [{ id: 'new', text: 'More', required: true }] })));
});
it('requires actual test argv, detailed plans, criteria and consistent snapshot hashes', () => {
  const plan = makePlan(binding, [task(1)], [], [['npm', 'test']]);
  expect(validatePlan(plan)).toEqual(plan);
  expect(() => validatePlan({ ...plan, tasks: [{ ...plan.tasks[0], checks: [] }] })).toThrow('check');
  expect(() => validatePlan({ ...plan, tasks: [{ ...plan.tasks[0], snapshot: task(1, { planMarkdown: '' }) }] })).toThrow();
  expect(() => validatePlan({ ...plan, integrationChecks: [['']] })).toThrow('argv');
});
