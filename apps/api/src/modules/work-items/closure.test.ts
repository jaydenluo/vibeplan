import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { users } from '../../db/schema.js';
import { AccessService } from '../access/service.js';
import { WorkItemService } from './service.js';

beforeAll(() => migrate());
async function fixture() {
  const [user] = await db.insert(users).values({ email: `closure-${randomUUID()}@example.com`, passwordHash: 'test', displayName: '负责人' }).returning();
  const access = new AccessService(db);
  const org = await access.createOrganization(user.id, 'Closure');
  const team = await access.createTeam(user.id, org.id, 'Core');
  const project = await access.createProject(user.id, team.id, 'Project');
  const service = new WorkItemService(db);
  const item = await service.create(user.id, project.id, { title: 'Task', description: '', type: 'feature', status: 'in_progress', priority: 'P1', acceptanceCriteria: ['Works'], dueDate: null, estimate: 1 });
  return { user, project, item, service, cleanup: async () => { await sqlClient`delete from organizations where id=${org.id}`; await sqlClient`delete from users where id=${user.id}`; } };
}

it('records before/after values and the actor, preserving handoff evidence', async () => {
  const f = await fixture();
  try {
    await f.service.update(f.user.id, f.item.id, f.item.version, { title: 'Renamed', progress: 40, changeReason: '范围调整' });
    const events = await f.service.history(f.user.id, f.item.id);
    expect(events.at(-1)).toMatchObject({ actorName: '负责人', payload: { changeReason: '范围调整', changes: { title: { before: 'Task', after: 'Renamed' }, progress: { before: 1, after: 40 } } } });
  } finally { await f.cleanup(); }
});

it('retains a failed execution report without claiming readiness for acceptance', async () => {
  const f = await fixture();
  try {
    const item = await f.service.report(f.user.id, f.item.id, f.item.version, { summary: '测试失败', outcome: 'failed', changedFiles: ['file.ts'], tests: [{ command: 'pnpm test', result: 'failed' }], remainingIssues: ['修复测试'], risks: ['发布受阻'], evidence: [] });
    expect(item.status).toBe('in_progress');
    expect((await f.service.history(f.user.id, item.id)).find((e) => e.action === 'report')?.payload).toMatchObject({ outcome: 'failed', remainingIssues: ['修复测试'] });
    await expect(f.service.report(f.user.id, item.id, item.version, { summary: 'Claim success', changedFiles: [], tests: [{ command: 'test', result: 'failed' }] })).rejects.toThrow('failed');
  } finally { await f.cleanup(); }
});

it('records only one report when two callers submit the same version', async () => {
  const f = await fixture();
  try {
    const report = { summary: 'Delivered', changedFiles: [], tests: [] };
    const results = await Promise.allSettled([f.service.report(f.user.id, f.item.id, f.item.version, report), f.service.report(f.user.id, f.item.id, f.item.version, report)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await f.service.history(f.user.id, f.item.id)).filter((e) => e.action === 'report')).toHaveLength(1);
  } finally { await f.cleanup(); }
});

it('rejects criterion evidence for another task', async () => {
  const f = await fixture();
  try {
    await expect(f.service.report(f.user.id, f.item.id, f.item.version, { summary: 'Delivered', changedFiles: [], tests: [], criterionResults: [{ acceptanceItemId: 'another-task-criterion', result: 'passed', evidence: [] }] })).rejects.toThrow('criterion');
  } finally { await f.cleanup(); }
});

it('validates dependencies on every write path and preserves the previous graph on rejection', async () => {
  const f = await fixture();
  try {
    const second = await f.service.create(f.user.id, f.project.id, { title: 'Second', description: '', type: 'feature', status: 'backlog', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1, dependsOn: [f.item.id] });
    await expect(f.service.update(f.user.id, f.item.id, f.item.version, { dependsOn: [second.id] })).rejects.toThrow('cycle');
    await expect(f.service.update(f.user.id, f.item.id, f.item.version, { dependsOn: [f.item.id] })).rejects.toThrow('itself');
    await expect(f.service.create(f.user.id, f.project.id, { title: 'Invalid', description: '', type: 'feature', status: 'backlog', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1, dependsOn: [randomUUID()] })).rejects.toThrow('same project');
    expect((await f.service.get(f.user.id, f.item.id)).dependsOn).toEqual([]);
  } finally { await f.cleanup(); }
});

it('records concurrent work logs without losing actual hours or versions', async () => {
  const f = await fixture();
  try {
    await Promise.all([1, 2].map((hours) => f.service.addWorkLog(f.user.id, f.item.id, { hours, content: 'Implemented', workDate: '2026-10-04' })));
    const item = await f.service.get(f.user.id, f.item.id);
    expect(Number(item.actualHours)).toBe(3);
    expect(item.version).toBe(f.item.version + 2);
    expect(await f.service.workLogs(f.user.id, f.item.id)).toHaveLength(2);
  } finally { await f.cleanup(); }
});

it('cannot reuse a failed or previous-cycle report by manually entering review', async () => {
  const f = await fixture();
  try {
    const failed = await f.service.report(f.user.id, f.item.id, f.item.version, { summary: 'Failed', outcome: 'failed', changedFiles: [], tests: [] });
    await expect(f.service.update(f.user.id, f.item.id, failed.version, { status: 'in_review' })).rejects.toThrow('successful execution report');
    const review = await f.service.report(f.user.id, f.item.id, failed.version, { summary: 'Fixed', changedFiles: [], tests: [] });
    await expect(f.service.update(f.user.id, f.item.id, review.version, { status: 'in_progress' })).rejects.toThrow('rejection workflow');
    const reopened = await f.service.accept(f.user.id, f.item.id, review.version, { decision: 'rejected', comment: '需要修复边界' });
    await expect(f.service.update(f.user.id, f.item.id, reopened.version, { status: 'in_review' })).rejects.toThrow('successful execution report');
  } finally { await f.cleanup(); }
});

it.each(['Tests failed', 'exit code 1', '测试失败'])('rejects false success with test result %s', async (result) => {
  const f = await fixture();
  try {
    await expect(f.service.report(f.user.id, f.item.id, f.item.version, { summary: 'Delivered', changedFiles: [], tests: [{ command: 'test', result }] })).rejects.toThrow('failed tests');
  } finally { await f.cleanup(); }
});

it('does not create an active task with unfinished dependencies', async () => {
  const f = await fixture();
  try {
    await expect(f.service.create(f.user.id, f.project.id, { title: 'Blocked child', description: '', type: 'feature', status: 'in_progress', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1, dependsOn: [f.item.id] })).rejects.toThrow('blocked');
  } finally { await f.cleanup(); }
});
