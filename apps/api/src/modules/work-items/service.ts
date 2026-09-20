import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { canTransition, type WorkItemStatus, type WorkItemType } from '@vibe/core';
import {
  organizationMemberships,
  projectMemberships,
  projects,
  taskEvents,
  teamMemberships,
  teams,
  workItems,
} from '../../db/schema.js';
import { ProjectEventHub } from './events.js';

export class WorkItemAccessError extends Error {
  constructor(message = 'You do not have access to this project.') {
    super(message);
    this.name = 'WorkItemAccessError';
  }
}

export class WorkItemConflictError extends Error {
  constructor(message = 'The work item changed since it was loaded.') {
    super(message);
    this.name = 'WorkItemConflictError';
  }
}

export class WorkItemTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkItemTransitionError';
  }
}

type CreateInput = {
  title: string;
  description?: string;
  type: WorkItemType;
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  acceptanceCriteria?: string[];
  assigneeId?: string | null;
  dueDate?: string | null;
};

type UpdateInput = Partial<{
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: CreateInput['priority'];
  acceptanceCriteria: string[];
  assigneeId: string | null;
  dueDate: string | null;
  acceptanceRecorded: boolean;
}>;

export class WorkItemService {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly eventHub?: ProjectEventHub,
  ) {}

  async create(userId: string, projectId: string, input: CreateInput) {
    await this.requireContributor(userId, projectId);
    const [item] = await this.database.insert(workItems).values({
      projectId,
      title: input.title,
      description: input.description ?? '',
      type: input.type,
      status: 'backlog',
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      reporterId: userId,
      dueDate: input.dueDate ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      labels: [],
      dependsOn: [],
      component: null,
      parentId: null,
      estimate: null,
    }).returning();
    await this.recordEvent(projectId, item.id, userId, 'created', { title: item.title });
    return item;
  }

  async list(userId: string, projectId: string, filters: { status?: WorkItemStatus; priority?: CreateInput['priority']; assigneeId?: string } = {}) {
    await this.requireViewer(userId, projectId);
    const conditions = [eq(workItems.projectId, projectId)];
    if (filters.status) conditions.push(eq(workItems.status, filters.status));
    if (filters.priority) conditions.push(eq(workItems.priority, filters.priority));
    if (filters.assigneeId) conditions.push(eq(workItems.assigneeId, filters.assigneeId));
    return this.database.select().from(workItems).where(and(...conditions)).orderBy(asc(workItems.createdAt));
  }

  async get(userId: string, workItemId: string) {
    const [item] = await this.database.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    if (!item) {
      throw new WorkItemAccessError('Work item does not exist.');
    }
    await this.requireViewer(userId, item.projectId);
    return item;
  }

  async update(userId: string, workItemId: string, expectedVersion: number, input: UpdateInput) {
    const existing = await this.get(userId, workItemId);
    await this.requireContributor(userId, existing.projectId);
    if (existing.version !== expectedVersion) {
      throw new WorkItemConflictError();
    }
    if (input.status && input.status !== existing.status) {
      const transition = canTransition({
        from: existing.status as WorkItemStatus,
        to: input.status,
        acceptanceRecorded: input.acceptanceRecorded,
      });
      if (!transition.ok) {
        throw new WorkItemTransitionError(transition.reason);
      }
    }

    const patch = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.acceptanceCriteria === undefined ? {} : { acceptanceCriteria: input.acceptanceCriteria }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      version: expectedVersion + 1,
      updatedAt: new Date(),
    };
    const [updated] = await this.database
      .update(workItems)
      .set(patch)
      .where(and(eq(workItems.id, workItemId), eq(workItems.version, expectedVersion)))
      .returning();
    if (!updated) {
      throw new WorkItemConflictError();
    }
    await this.recordEvent(updated.projectId, updated.id, userId, 'updated', input);
    return updated;
  }

  async events(projectId: string) {
    return this.database.select().from(taskEvents).where(eq(taskEvents.projectId, projectId)).orderBy(asc(taskEvents.createdAt));
  }

  async assertViewer(userId: string, projectId: string): Promise<void> {
    await this.requireViewer(userId, projectId);
  }

  private async recordEvent(projectId: string, workItemId: string, actorId: string, action: string, payload: Record<string, unknown>) {
    await this.database.insert(taskEvents).values({ projectId, workItemId, actorId, action, payload });
    this.eventHub?.publish({ projectId, workItemId, action, payload });
  }

  private async requireViewer(userId: string, projectId: string): Promise<void> {
    const [project] = await this.database
      .select({ id: projects.id, organizationId: teams.organizationId })
      .from(projects)
      .innerJoin(teams, eq(projects.teamId, teams.id))
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new WorkItemAccessError('Project does not exist.');
    const [organizationMembership] = await this.database
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, project.organizationId)))
      .limit(1);
    if (!organizationMembership) throw new WorkItemAccessError();
    const [teamMembership] = await this.database
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .innerJoin(projects, eq(projects.teamId, teamMemberships.teamId))
      .where(and(eq(projects.id, projectId), eq(teamMemberships.userId, userId)))
      .limit(1);
    const [projectMembership] = await this.database
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
      .limit(1);
    const isOrgAdmin = ['owner', 'admin'].includes(organizationMembership.role);
    const canView = isOrgAdmin || Boolean(teamMembership) || Boolean(projectMembership);
    if (!canView) throw new WorkItemAccessError();
  }

  private async requireContributor(userId: string, projectId: string): Promise<void> {
    await this.requireViewer(userId, projectId);
    const [project] = await this.database.select({ teamId: projects.teamId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    const [membership] = await this.database
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
      .limit(1);
    const [teamMembership] = await this.database
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, project!.teamId), eq(teamMemberships.userId, userId)))
      .limit(1);
    if (!['owner', 'admin'].includes(membership?.role ?? '') && !['lead', 'member'].includes(teamMembership?.role ?? '') && membership?.role !== 'maintainer' && membership?.role !== 'contributor') {
      throw new WorkItemAccessError('Contributor access is required.');
    }
  }
}
