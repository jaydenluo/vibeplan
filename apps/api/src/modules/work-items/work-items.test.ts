import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, sqlClient } from '../../db/client.js';
import { migrate } from '../../db/migrate.js';
import { users, teamMemberships } from '../../db/schema.js';
import { AccessService } from '../access/service.js';
import { WorkItemService, WorkItemConflictError } from './service.js';

describe('work item service', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('creates work items, records events, and rejects stale updates', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `work-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Work Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Core Project', 'https://example.com/core.git');
    const workItems = new WorkItemService(db);

    const item = await workItems.create(user.id, project.id, {
      title: 'Add login',
      description: 'Implement email login',
      type: 'feature',
      status: 'ready',
      priority: 'P1',
      progress: 35,
      acceptanceCriteria: ['User can sign in'],
      dueDate: '2026-10-20',
      estimate: 3,
    });
    expect(item.status).toBe('ready');
    expect(item.progress).toBe(0);

    const ready = await workItems.update(user.id, item.id, item.version, { status: 'ready' });
    expect(ready.version).toBe(2);
    const assigned = await workItems.update(user.id, item.id, ready.version, { assigneeId: user.id });
    expect(assigned.assigneeId).toBe(user.id);
    await expect(workItems.update(user.id, item.id, item.version, { status: 'in_progress' })).rejects.toBeInstanceOf(WorkItemConflictError);

    const events = await workItems.events(project.id);
    expect(events.map((event) => event.action)).toEqual(['created', 'updated', 'updated']);
    expect(events[2].payload).toMatchObject({ previousAssigneeId: null, newAssigneeId: user.id, handoffProgress: 0 });
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('requires a report and acceptance before completing a task', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `report-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Report Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Report Project', 'https://example.com/report.git');
    const service = new WorkItemService(db);
    const item = await service.create(user.id, project.id, {
      title: 'Sync task', description: 'Sync status', type: 'feature', status: 'ready', priority: 'P1',
      acceptanceCriteria: ['Status is visible'], dueDate: '2026-10-20', estimate: 2,
    });
    const started = await service.update(user.id, item.id, item.version, { status: 'in_progress' });
    const reported = await service.report(user.id, item.id, started.version, {
      summary: 'Implemented sync', changedFiles: ['apps/cli/src/commands/task.ts'], tests: [{ command: 'pnpm test', result: 'passed' }], commit: 'abc1234',
    });
    await expect(service.update(user.id, item.id, reported.version, { status: 'done' })).rejects.toThrow('required acceptance criteria');
    const reviewed = await service.updateAcceptanceItem(user.id, item.id, reported.version, reported.acceptanceItems[0].id, {
      status: 'passed', comment: '检查通过', evidence: [{ label: '测试报告', url: 'https://example.com/report' }],
    });
    const accepted = await service.accept(user.id, item.id, reviewed.version, { decision: 'approved' });
    expect(accepted.status).toBe('done');
    expect(accepted.progress).toBe(100);
    const completed = await service.update(user.id, item.id, accepted.version, { progress: 20 });
    expect(completed.progress).toBe(100);
    expect((await service.history(user.id, item.id)).map((event) => event.action)).toContain('report');
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('requires an authorized approval and a reason for rejection', async () => {
    const suffix = randomUUID();
    const [owner, member] = await db.insert(users).values([
      { email: `review-owner-${suffix}@example.com`, passwordHash: 'test' },
      { email: `review-member-${suffix}@example.com`, passwordHash: 'test' },
    ]).returning();
    const access = new AccessService(db);
    const org = await access.createOrganization(owner.id, `Review ${suffix}`);
    const team = await access.createTeam(owner.id, org.id, 'Core');
    await sqlClient`insert into organization_memberships (organization_id,user_id,role) values (${org.id},${member.id},'member')`;
    await db.insert(teamMemberships).values({ teamId: team.id, userId: member.id, role: 'member' });
    const project = await access.createProject(owner.id, team.id, 'Review Project');
    const service = new WorkItemService(db);
    const input = { title: 'Review', description: '', type: 'feature' as const, status: 'ready' as const, priority: 'P1' as const, acceptanceCriteria: ['Works'], dueDate: null, estimate: 1 };
    await expect(service.create(owner.id, project.id, { ...input, status: 'done' })).rejects.toThrow('approval');
    const item = await service.create(owner.id, project.id, input);
    const started = await service.update(owner.id, item.id, item.version, { status: 'in_progress' });
    const reported = await service.report(owner.id, item.id, started.version, { summary: 'Delivered', changedFiles: [], tests: [] });
    await expect(service.updateAcceptanceItem(member.id, item.id, reported.version, reported.acceptanceItems[0].id, { status: 'passed', comment: '', evidence: [] })).rejects.toThrow('Reviewer');
    const reviewed = await service.updateAcceptanceItem(owner.id, item.id, reported.version, reported.acceptanceItems[0].id, { status: 'passed', comment: '', evidence: [] });
    await expect(service.update(owner.id, item.id, reviewed.version, { status: 'done', acceptanceRecorded: true })).rejects.toThrow('approval');
    await expect(service.accept(member.id, item.id, reviewed.version, { decision: 'approved' })).rejects.toThrow('Reviewer');
    await expect(service.accept(owner.id, item.id, reviewed.version, { decision: 'rejected' })).rejects.toThrow('reason');
    const rejected = await service.accept(owner.id, item.id, reviewed.version, { decision: 'rejected', comment: '缺少边界测试' });
    expect(rejected.status).toBe('in_progress');
    const resubmitted = await service.report(owner.id, item.id, rejected.version, { summary: 'Fixed', changedFiles: [], tests: [] });
    expect(resubmitted.acceptanceItems[0].status).toBe('unverified');
    const rechecked = await service.updateAcceptanceItem(owner.id, item.id, resubmitted.version, resubmitted.acceptanceItems[0].id, { status: 'passed', comment: '本轮重新验收', evidence: [] });
    const completed = await service.accept(owner.id, item.id, rechecked.version, { decision: 'approved' });
    await expect(service.updateAcceptanceItem(owner.id, item.id, completed.version, completed.acceptanceItems[0].id, { status: 'failed', comment: '', evidence: [] })).rejects.toThrow('Reopen');
    await expect(service.update(owner.id, item.id, completed.version, { acceptanceCriteria: ['New requirement'] })).rejects.toThrow('Reopen');
    expect((await service.history(owner.id, item.id)).filter((e) => e.action === 'acceptance').map((e) => e.payload.decision)).toEqual(['rejected', 'approved']);
    await sqlClient`delete from organizations where id = ${org.id}`;
    await sqlClient`delete from users where id in (${owner.id},${member.id})`;
  });

  it('records criterion evidence and prevents accepting a task with a failed required criterion', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `criterion-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Criterion Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Criterion Project', 'https://example.com/criterion.git');
    const service = new WorkItemService(db, undefined, () => new Date('2026-10-02T08:00:00.000Z'));
    const item = await service.create(user.id, project.id, {
      title: 'Verify delivery', description: '', type: 'feature', status: 'ready', priority: 'P1',
      acceptanceCriteria: ['用户可以登录', '测试报告已关联'], dueDate: null, estimate: 2,
    });
    const acceptanceItems = (item as typeof item & { acceptanceItems?: Array<{ id: string; status: string; required: boolean }> }).acceptanceItems;
    expect(acceptanceItems).toEqual([
      expect.objectContaining({ text: '用户可以登录', status: 'unverified', required: true }),
      expect.objectContaining({ text: '测试报告已关联', status: 'unverified', required: true }),
    ]);

    const started = await service.update(user.id, item.id, item.version, { status: 'in_progress' });
    const reported = await service.report(user.id, item.id, started.version, { summary: 'Delivered', changedFiles: [], tests: [] });
    const reviewed = await (service as unknown as { updateAcceptanceItem: (userId: string, workItemId: string, version: number, acceptanceItemId: string, input: { status: 'failed'; comment: string; evidence: Array<{ label: string; url: string }> }) => Promise<typeof item> }).updateAcceptanceItem(
      user.id,
      item.id,
      reported.version,
      acceptanceItems![0].id,
      { status: 'failed', comment: '登录流程仍返回 500', evidence: [{ label: '测试记录', url: 'https://example.com/test-log' }] },
    );
    const reviewedItems = (reviewed as typeof reviewed & { acceptanceItems?: Array<{ status: string; comment: string; reviewedBy: string; reviewedAt: string; evidence: Array<{ label: string; url: string }> }> }).acceptanceItems;
    expect(reviewedItems?.[0]).toMatchObject({ status: 'failed', comment: '登录流程仍返回 500', reviewedBy: user.id, reviewedAt: '2026-10-02T08:00:00.000Z', evidence: [{ label: '测试记录', url: 'https://example.com/test-log' }] });
    const retitled = await service.update(user.id, item.id, reviewed.version, { title: 'Verify delivery again', acceptanceCriteria: ['用户可以登录', '测试报告已关联'] });
    expect(retitled.acceptanceItems[0]).toMatchObject({ status: 'failed', comment: '登录流程仍返回 500' });
    await expect(service.accept(user.id, item.id, retitled.version, { decision: 'approved' })).rejects.toThrow('required acceptance criteria');
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('sets an end date from the estimate when an unscheduled task starts', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `schedule-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Schedule Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Schedule Project', 'https://example.com/schedule.git');
    const service = new WorkItemService(db, undefined, () => new Date('2026-10-01T08:00:00+08:00'));
    const item = await service.create(user.id, project.id, {
      title: 'Unscheduled task', description: '', type: 'feature', status: 'ready', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 3,
    });

    const started = await service.update(user.id, item.id, item.version, { status: 'in_progress' });
    expect(started.dueDate).toBe('2026-10-03');
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('rolls parent schedule dates and duration up from scheduled child tasks', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `rollup-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Rollup Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Rollup Project');
    const service = new WorkItemService(db);
    const parent = await service.create(user.id, project.id, { title: 'Parent', description: '', type: 'feature', status: 'ready', priority: 'P2', acceptanceCriteria: [], dueDate: '2026-10-01', estimate: 1 });
    const child = await service.create(user.id, project.id, { title: 'Child', description: '', type: 'feature', status: 'ready', priority: 'P2', acceptanceCriteria: [], dueDate: '2026-10-06', estimate: 2, parentId: parent.id });
    const sibling = await service.create(user.id, project.id, { title: 'Sibling', description: '', type: 'feature', status: 'ready', priority: 'P2', acceptanceCriteria: [], dueDate: '2026-10-10', estimate: 3, parentId: parent.id });

    const rolledUpParent = await service.get(user.id, parent.id);
    expect(rolledUpParent).toMatchObject({ dueDate: '2026-10-10', estimate: 6 });
    await expect(service.update(user.id, parent.id, rolledUpParent.version, { dueDate: '2026-10-12', estimate: 1 })).rejects.toThrow('derived from child');
    const movedChild = await service.update(user.id, child.id, child.version, { dueDate: '2026-10-04', estimate: 1 });
    expect(movedChild).toMatchObject({ dueDate: '2026-10-04', estimate: 1 });
    expect(await service.get(user.id, parent.id)).toMatchObject({ dueDate: '2026-10-10', estimate: 7 });
    expect((await service.get(user.id, sibling.id)).estimate).toBe(3);
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('deletes a task together with all of its child tasks', async () => {
    const suffix = randomUUID();
    const [user] = await db.insert(users).values({ email: `delete-${suffix}@example.com`, passwordHash: 'test' }).returning();
    const access = new AccessService(db);
    const organization = await access.createOrganization(user.id, `Delete Org ${suffix}`);
    const team = await access.createTeam(user.id, organization.id, 'Core');
    const project = await access.createProject(user.id, team.id, 'Delete Project', 'https://example.com/delete.git');
    const service = new WorkItemService(db);
    const parent = await service.create(user.id, project.id, {
      title: 'Parent', description: '', type: 'feature', status: 'backlog', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1,
    });
    await service.create(user.id, project.id, {
      title: 'Child', description: '', type: 'feature', status: 'backlog', priority: 'P2', acceptanceCriteria: [], dueDate: null, estimate: 1, parentId: parent.id,
    });

    await expect(service.remove(user.id, parent.id, parent.version)).resolves.toMatchObject({ status: 'deleted' });
    expect(await service.list(user.id, project.id)).toEqual([]);
    await sqlClient`delete from organizations where id = ${organization.id}`;
    await sqlClient`delete from users where id = ${user.id}`;
  });
});
