import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
  users,
} from '../../db/schema.js';

export class AccessError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

const orgAdminRoles = ['owner', 'admin'] as const;

export class AccessService {
  constructor(private readonly database: PostgresJsDatabase) {}

  async createOrganization(userId: string, name: string, slug: string) {
    const [organization] = await this.database.insert(organizations).values({ name, slug }).returning();
    await this.database.insert(organizationMemberships).values({ userId, organizationId: organization.id, role: 'owner' });
    return organization;
  }

  async createTeam(userId: string, organizationId: string, name: string, slug: string) {
    await this.requireOrganizationRole(userId, organizationId, orgAdminRoles);
    const [team] = await this.database.insert(teams).values({ organizationId, name, slug }).returning();
    await this.database.insert(teamMemberships).values({ userId, teamId: team.id, role: 'lead' });
    return team;
  }

  async createProject(userId: string, teamId: string, name: string, slug: string, repositoryUrl: string) {
    const [team] = await this.database.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) {
      throw new AccessError('NOT_FOUND', 'Team does not exist.');
    }
    const organizationRole = await this.organizationRole(userId, team.organizationId);
    const [teamMembership] = await this.database
      .select({ role: teamMemberships.role })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.userId, userId), eq(teamMemberships.teamId, teamId)))
      .limit(1);
    const canCreate = orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number]) || teamMembership?.role === 'lead';
    if (!canCreate) {
      throw new AccessError('FORBIDDEN', 'You do not have permission to create a project in this team.');
    }

    const [project] = await this.database.insert(projects).values({ teamId, name, slug, repositoryUrl }).returning();
    await this.database.insert(projectMemberships).values({ userId, projectId: project.id, role: 'maintainer' });
    return project;
  }

  async listOrganizations(userId: string) {
    return this.database
      .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: organizationMemberships.role })
      .from(organizations)
      .innerJoin(organizationMemberships, and(
        eq(organizationMemberships.organizationId, organizations.id),
        eq(organizationMemberships.userId, userId),
      ))
      .orderBy(asc(organizations.createdAt));
  }

  async listTeams(userId: string, organizationId: string) {
    await this.requireOrganizationRole(userId, organizationId, ['owner', 'admin', 'member']);
    const [membership] = await this.database
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId)))
      .limit(1);
    if (orgAdminRoles.includes(membership.role as (typeof orgAdminRoles)[number])) {
      return this.database.select().from(teams).where(eq(teams.organizationId, organizationId)).orderBy(asc(teams.createdAt));
    }
    return this.database
      .select({ id: teams.id, organizationId: teams.organizationId, name: teams.name, slug: teams.slug, createdAt: teams.createdAt, updatedAt: teams.updatedAt })
      .from(teams)
      .innerJoin(teamMemberships, and(eq(teamMemberships.teamId, teams.id), eq(teamMemberships.userId, userId)))
      .where(eq(teams.organizationId, organizationId))
      .orderBy(asc(teams.createdAt));
  }

  async listProjects(organizationId: string, userId: string) {
    const [organizationMembership] = await this.database
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId)))
      .limit(1);
    if (!organizationMembership) {
      return [];
    }
    const organizationRole = organizationMembership.role;
    const teamIds = orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])
      ? (await this.database.select({ id: teams.id }).from(teams).where(eq(teams.organizationId, organizationId))).map((team) => team.id)
      : (await this.database
        .select({ id: teams.id })
        .from(teams)
        .innerJoin(teamMemberships, and(eq(teamMemberships.teamId, teams.id), eq(teamMemberships.userId, userId)))
        .where(eq(teams.organizationId, organizationId))).map((team) => team.id);
    if (teamIds.length === 0) {
      return [];
    }
    return this.database.select().from(projects).where(inArray(projects.teamId, teamIds)).orderBy(asc(projects.createdAt));
  }

  private async organizationRole(userId: string, organizationId: string): Promise<string> {
    const [membership] = await this.database
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.organizationId, organizationId)))
      .limit(1);
    if (!membership) {
      throw new AccessError('NOT_FOUND', 'Organization does not exist or is not accessible.');
    }
    return membership.role;
  }

  private async requireOrganizationRole(userId: string, organizationId: string, roles: readonly string[]) {
    const role = await this.organizationRole(userId, organizationId);
    if (!roles.includes(role)) {
      throw new AccessError('FORBIDDEN', 'You do not have permission to perform this action.');
    }
  }
}
