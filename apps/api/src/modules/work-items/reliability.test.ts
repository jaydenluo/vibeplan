import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { users, organizationMemberships, teamMemberships } from '../../db/schema.js';
import { AccessService } from '../access/service.js';
import { WorkItemService } from './service.js';

beforeAll(() => migrate());
export async function reliabilityFixture() {
  const people = await db.insert(users).values(['Owner', 'Member'].map((displayName) => ({ email: `${randomUUID()}@example.com`, passwordHash: 'test', displayName }))).returning();
  const [owner, member] = people;
  const access = new AccessService(db);
  const org = await access.createOrganization(owner.id, 'Reliability');
  const team = await access.createTeam(owner.id, org.id, 'Core');
  const project = await access.createProject(owner.id, team.id, 'Project');
  await db.insert(organizationMemberships).values({ organizationId: org.id, userId: member.id, role: 'member' });
  await db.insert(teamMemberships).values({ teamId: team.id, userId: member.id, role: 'member' });
  const service = new WorkItemService(db);
  const create = (title = 'Task', extra = {}) => service.create(owner.id, project.id, { title, description: '', type: 'feature', status: 'in_progress', priority: 'P1', acceptanceCriteria: ['Works'], dueDate: null, estimate: 1, assigneeId: member.id, ...extra });
  return { owner, member, org, project, service, create, cleanup: async () => { await sqlClient`delete from organizations where id=${org.id}`; await sqlClient`delete from users where id in ${sqlClient(people.map((p) => p.id))}`; } };
}

it('rejects explicit failed tests and nonzero exit codes even when result text says passed', async () => {
  const f = await reliabilityFixture();
  try {
    const task = await f.create();
    for (const test of [{ command: 'test', result: 'passed', outcome: 'failed' }, { command: 'test', result: 'passed', exitCode: 1 }]) {
      await expect(f.service.report(f.member.id, task.id, task.version, { summary: 'Delivered', changedFiles: [], tests: [test as never] })).rejects.toThrow('failed tests');
    }
  } finally { await f.cleanup(); }
});

it('resets reviewed criteria on rejection and requires a new report for the next cycle', async () => {
  const f = await reliabilityFixture();
  try {
    let task = await f.create();
    task = await f.service.report(f.member.id, task.id, task.version, { summary: 'First', changedFiles: [], tests: [] });
    await expect(f.service.update(f.member.id, task.id, task.version, { acceptanceCriteria: ['Different scope'] })).rejects.toThrow('Reject');
    await expect(f.service.update(f.member.id, task.id, task.version, { status: 'blocked' })).rejects.toThrow('rejection workflow');
    task = await f.service.updateAcceptanceItem(f.owner.id, task.id, task.version, task.acceptanceItems[0].id, { status: 'passed', comment: 'OK', evidence: [] });
    task = await f.service.accept(f.owner.id, task.id, task.version, { decision: 'rejected', comment: 'Fix edge case' });
    expect(task.acceptanceItems[0].status).toBe('unverified');
    task = await f.service.report(f.member.id, task.id, task.version, { summary: 'Second', changedFiles: [], tests: [] });
    await expect(f.service.accept(f.owner.id, task.id, task.version, { decision: 'approved' })).rejects.toThrow('criteria');
  } finally { await f.cleanup(); }
});

it('orders events deterministically within a project even when clocks have identical timestamps', async () => {
  const f = await reliabilityFixture();
  try {
    const service = new WorkItemService(db, undefined, () => new Date('2026-10-05T00:00:00Z'));
    const task = await service.create(f.owner.id, f.project.id, { title: 'Ordered', description: '', type: 'feature', status: 'ready', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1 });
    let current = await service.update(f.owner.id, task.id, task.version, { status: 'in_progress' });
    current = await service.report(f.owner.id, task.id, current.version, { summary: 'First', changedFiles: [], tests: [] });
    current = await service.accept(f.owner.id, task.id, current.version, { decision: 'rejected', comment: 'Again' });
    current = await service.report(f.owner.id, task.id, current.version, { summary: 'Second', changedFiles: [], tests: [] });
    const events = await service.history(f.owner.id, task.id);
    expect(events.every((event) => event.sequence > 0)).toBe(true);
    expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
    expect((await service.accept(f.owner.id, task.id, current.version, { decision: 'approved' })).status).toBe('done');
  } finally { await f.cleanup(); }
});

it('keeps actual hours with the recording member after handoff and audits corrections', async () => {
  const f = await reliabilityFixture();
  try {
    const task = await f.create();
    const log = await f.service.addWorkLog(f.member.id, task.id, { hours: 2, content: 'Implemented', workDate: '2026-10-05' });
    const latest = await f.service.get(f.owner.id, task.id);
    await f.service.update(f.owner.id, task.id, latest.version, { assigneeId: f.owner.id });
    const contributions = await f.service.contributors(f.owner.id, f.project.id);
    expect(contributions.members.find((m) => m.userId === f.member.id)?.hours).toBe(2);
    expect((await f.service.contributors(f.owner.id, f.project.id, { from: '2026-10-06' })).members).toEqual([]);
    await expect(f.service.correctWorkLog(f.owner.id, task.id, log.id, 1, { hours: 8, reason: 'Not mine' })).rejects.toThrow('author');
    await f.service.correctWorkLog(f.member.id, task.id, log.id, 1, { hours: 1.5, reason: 'Correct timer' });
    expect(Number((await f.service.get(f.owner.id, task.id)).actualHours)).toBe(1.5);
    await expect(f.service.correctWorkLog(f.member.id, task.id, log.id, 1, { hours: 1, reason: 'stale' })).rejects.toThrow('changed');
    await f.service.correctWorkLog(f.member.id, task.id, log.id, 2, { revoked: true, reason: 'Duplicate record' });
    expect(Number((await f.service.get(f.owner.id, task.id)).actualHours)).toBe(0);
    expect((await f.service.history(f.owner.id, task.id)).filter((e) => e.action === 'work_log_corrected')).toHaveLength(2);
  } finally { await f.cleanup(); }
});

it('recommends only assigned unblocked tasks and exposes review only to reviewers', async () => {
  const f = await reliabilityFixture();
  try {
    const blocker = await f.create('Blocker');
    const ready = await f.create('Ready', { status: 'backlog' });
    await f.create('Dependent', { status: 'backlog', dependsOn: [blocker.id] });
    await f.service.report(f.member.id, blocker.id, blocker.version, { summary: 'Delivered', changedFiles: [], tests: [] });
    const mine = await f.service.myWork(f.member.id, f.org.id);
    expect(mine.ready.map((t) => t.id)).toContain(ready.id);
    expect(mine.blocked.map((t) => t.title)).toContain('Dependent');
    expect(mine.inReview).toEqual([]);
    expect((await f.service.myWork(f.owner.id, f.org.id)).inReview.map((t) => t.id)).toContain(blocker.id);
    await sqlClient`delete from team_memberships where user_id=${f.member.id}`;
    await sqlClient`insert into project_memberships(project_id,user_id,role) values(${f.project.id},${f.member.id},'viewer')`;
    const viewer = await f.service.myWork(f.member.id, f.org.id);
    expect(viewer.ready).toEqual([]);
    expect(viewer.blocked).toEqual([]);
    expect(viewer.inReview).toEqual([]);
  } finally { await f.cleanup(); }
});
