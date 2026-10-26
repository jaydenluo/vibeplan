import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  organizationMemberships,
  organizationInvitations,
  membershipInvites,
  organizations,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
  teamJoinRequests,
  users,
} from '../../db/schema.js';
import { EntitlementService } from '../billing/entitlements.js';

export class AccessError extends Error {
  constructor(public readonly code: 'FORBIDDEN' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

const orgAdminRoles = ['owner', 'admin'] as const;

export class AccessService {
  constructor(
    private readonly database: PostgresJsDatabase,
    private readonly entitlements = new EntitlementService(database),
  ) {}

  async createOrganization(userId: string, name: string) {
    const [organization] = await this.database.insert(organizations).values({ name, slug: makeSlug('org', name) }).returning();
    await this.database.insert(organizationMemberships).values({ userId, organizationId: organization.id, role: 'owner' });
    return organization;
  }

  async createTeam(userId: string, organizationId: string, name: string) {
    await this.requireOrganizationRole(userId, organizationId, orgAdminRoles);
    await this.entitlements.assertCanWrite(organizationId);
    const [team] = await this.database.insert(teams).values({ organizationId, name, slug: makeSlug('team', name) }).returning();
    await this.database.insert(teamMemberships).values({ userId, teamId: team.id, role: 'lead' });
    return team;
  }

  async updateTeam(userId: string, teamId: string, name: string) {
    const [team] = await this.database.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
    await this.requireTeamManager(userId, teamId);
    await this.entitlements.assertCanWrite(team.organizationId);
    const [updated] = await this.database.update(teams)
      .set({ name, slug: makeSlug('team', name), updatedAt: new Date() })
      .where(eq(teams.id, teamId))
      .returning();
    return updated;
  }

  async createProject(userId: string, teamId: string, name: string, repositoryUrl?: string, description = '') {
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
    await this.entitlements.assertCanCreateProject(team.organizationId);

    const [project] = await this.database.insert(projects).values({ teamId, name, slug: makeSlug('project', name), description: description.trim(), repositoryUrl: repositoryUrl?.trim() || null }).returning();
    await this.database.insert(projectMemberships).values({ userId, projectId: project.id, role: 'maintainer' });
    return project;
  }

  async updateProject(userId: string, projectId: string, input: { name?: string; description?: string; repositoryUrl?: string | null }) {
    const [project] = await this.database.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new AccessError('NOT_FOUND', 'Project does not exist.');
    await this.requireTeamManager(userId, project.teamId);
    const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, project.teamId)).limit(1);
    await this.entitlements.assertCanWrite(team!.organizationId);
    const updates: { name?: string; slug?: string; description?: string; repositoryUrl?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (input.name !== undefined) {
      updates.name = input.name;
      updates.slug = makeSlug('project', input.name);
    }
    if (input.description !== undefined) updates.description = input.description.trim();
    if (input.repositoryUrl !== undefined) updates.repositoryUrl = input.repositoryUrl?.trim() || null;
    const [updated] = await this.database.update(projects).set(updates).where(eq(projects.id, projectId)).returning();
    return updated;
  }

  async inviteMember(userId: string, organizationId: string, email: string, teamId?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const organizationRole = await this.organizationRole(userId, organizationId);
    if (teamId) {
      const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
      if (!team || team.organizationId !== organizationId) throw new AccessError('NOT_FOUND', 'Team does not exist or is not accessible.');
      if (!orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])) {
        const [teamMembership] = await this.database.select({ role: teamMemberships.role }).from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId))).limit(1);
        if (teamMembership?.role !== 'lead') throw new AccessError('FORBIDDEN', 'Team lead access is required.');
      }
    } else if (!orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])) {
      throw new AccessError('FORBIDDEN', 'Organization admin access is required.');
    }
    await this.entitlements.assertCanAddMember(organizationId);
    const [invitation] = await this.database.insert(organizationInvitations).values({
      organizationId,
      teamId: teamId ?? null,
      email: normalizedEmail,
      inviterId: userId,
    }).returning();
    return invitation;
  }

  async createInviteLink(userId: string, organizationId: string, teamId?: string) {
    const organizationRole = await this.organizationRole(userId, organizationId);
    if (teamId) {
      const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
      if (!team || team.organizationId !== organizationId) throw new AccessError('NOT_FOUND', 'Team does not exist or is not accessible.');
      if (!orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])) {
        const [membership] = await this.database.select({ role: teamMemberships.role }).from(teamMemberships)
          .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId))).limit(1);
        if (membership?.role !== 'lead') throw new AccessError('FORBIDDEN', 'Team lead access is required.');
      }
    } else if (!orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])) {
      throw new AccessError('FORBIDDEN', 'Organization admin access is required.');
    }
    await this.entitlements.assertCanAddMember(organizationId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.database.insert(membershipInvites).values({
      tokenHash: hashInviteToken(token),
      organizationId,
      teamId: teamId ?? null,
      inviterId: userId,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async getInviteLink(token: string) {
    const [invite] = await this.database.select({
      id: membershipInvites.id,
      organizationId: membershipInvites.organizationId,
      teamId: membershipInvites.teamId,
      status: membershipInvites.status,
      expiresAt: membershipInvites.expiresAt,
      organizationName: organizations.name,
      teamName: teams.name,
    }).from(membershipInvites)
      .innerJoin(organizations, eq(organizations.id, membershipInvites.organizationId))
      .leftJoin(teams, eq(teams.id, membershipInvites.teamId))
      .where(eq(membershipInvites.tokenHash, hashInviteToken(token))).limit(1);
    if (!invite || invite.status !== 'active' || invite.expiresAt <= new Date()) throw new AccessError('NOT_FOUND', 'Invite link is invalid or expired.');
    return invite;
  }

  async acceptInviteLink(userId: string, token: string) {
    return this.database.transaction(async (tx) => {
      const service = new AccessService(tx as unknown as PostgresJsDatabase, new EntitlementService(tx as unknown as PostgresJsDatabase));
      // Claim the active row inside the transaction. PostgreSQL's UPDATE lock
      // makes revoke and accept serialize without allowing a stale read.
      const [claimed] = await tx.update(membershipInvites)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(membershipInvites.tokenHash, hashInviteToken(token)),
          eq(membershipInvites.status, 'active'),
          gt(membershipInvites.expiresAt, new Date()),
        ))
        .returning({ id: membershipInvites.id });
      if (!claimed) throw new AccessError('NOT_FOUND', 'Invite link is invalid or expired.');
      const [invite] = await tx.select({
        id: membershipInvites.id,
        organizationId: membershipInvites.organizationId,
        teamId: membershipInvites.teamId,
        organizationName: organizations.name,
        teamName: teams.name,
      }).from(membershipInvites)
        .innerJoin(organizations, eq(organizations.id, membershipInvites.organizationId))
        .leftJoin(teams, eq(teams.id, membershipInvites.teamId))
        .where(eq(membershipInvites.id, claimed.id)).limit(1);
      if (!invite) throw new AccessError('NOT_FOUND', 'Invite link is invalid or expired.');
      await service.entitlements.assertCanAddMember(invite.organizationId, userId);
      await tx.insert(organizationMemberships).values({ userId, organizationId: invite.organizationId, role: 'member' }).onConflictDoNothing();
      if (invite.teamId) await tx.insert(teamMemberships).values({ userId, teamId: invite.teamId, role: 'member' }).onConflictDoNothing();
      return { organizationId: invite.organizationId, teamId: invite.teamId, organizationName: invite.organizationName, teamName: invite.teamName };
    });
  }

  async revokeInviteLink(userId: string, token: string) {
    const [invite] = await this.database.select({ id: membershipInvites.id, organizationId: membershipInvites.organizationId, teamId: membershipInvites.teamId })
      .from(membershipInvites).where(eq(membershipInvites.tokenHash, hashInviteToken(token))).limit(1);
    if (!invite) throw new AccessError('NOT_FOUND', 'Invite link does not exist.');
    if (invite.teamId) {
      await this.requireTeamManager(userId, invite.teamId);
    } else {
      await this.requireOrganizationRole(userId, invite.organizationId, orgAdminRoles);
    }
    const [updated] = await this.database.update(membershipInvites).set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(membershipInvites.id, invite.id), eq(membershipInvites.status, 'active'))).returning({ status: membershipInvites.status });
    if (!updated) throw new AccessError('NOT_FOUND', 'Invite link is already inactive.');
    return updated;
  }

  async listPending(userId: string) {
    const [user] = await this.database.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AccessError('NOT_FOUND', 'User does not exist.');
    const invitations = await this.database.select({
      id: organizationInvitations.id,
      organizationId: organizationInvitations.organizationId,
      teamId: organizationInvitations.teamId,
      email: organizationInvitations.email,
      status: organizationInvitations.status,
      createdAt: organizationInvitations.createdAt,
      organizationName: organizations.name,
      teamName: teams.name,
    }).from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .leftJoin(teams, eq(teams.id, organizationInvitations.teamId))
      .where(and(eq(organizationInvitations.email, user.email), eq(organizationInvitations.status, 'pending')));
    const joinRequests = await this.database.select({
      id: teamJoinRequests.id,
      teamId: teamJoinRequests.teamId,
      status: teamJoinRequests.status,
      createdAt: teamJoinRequests.createdAt,
      teamName: teams.name,
      organizationId: teams.organizationId,
    }).from(teamJoinRequests)
      .innerJoin(teams, eq(teams.id, teamJoinRequests.teamId))
      .where(and(eq(teamJoinRequests.userId, userId), eq(teamJoinRequests.status, 'pending')));
    return { invitations, joinRequests };
  }

  async acceptInvitation(userId: string, invitationId: string) {
    return this.database.transaction(async (tx) => {
      const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      const [pending] = await tx.select({ email: organizationInvitations.email })
        .from(organizationInvitations)
        .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.status, 'pending')))
        .limit(1);
      if (!user || !pending || pending.email !== user.email) throw new AccessError('NOT_FOUND', 'Invitation does not exist or is not accessible.');

      // Claim the pending row before entitlement checks and membership writes.
      // A concurrent reject/accept can therefore only win one terminal state.
      const [invitation] = await tx.update(organizationInvitations)
        .set({ status: 'accepted', updatedAt: new Date() })
        .where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.status, 'pending')))
        .returning();
      if (!invitation) throw new AccessError('NOT_FOUND', 'Invitation does not exist or is not accessible.');
      const entitlementService = new EntitlementService(tx as unknown as PostgresJsDatabase);
      await entitlementService.assertCanAddMember(invitation.organizationId, userId);
      await tx.insert(organizationMemberships).values({ userId, organizationId: invitation.organizationId, role: invitation.role }).onConflictDoNothing();
      if (invitation.teamId) await tx.insert(teamMemberships).values({ userId, teamId: invitation.teamId, role: 'member' }).onConflictDoNothing();
      return invitation;
    });
  }

  async rejectInvitation(userId: string, invitationId: string) {
    const [user] = await this.database.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    const [invitation] = await this.database.select().from(organizationInvitations).where(and(eq(organizationInvitations.id, invitationId), eq(organizationInvitations.status, 'pending'))).limit(1);
    if (!user || !invitation || invitation.email !== user.email) throw new AccessError('NOT_FOUND', 'Invitation does not exist or is not accessible.');
    const [updated] = await this.database.update(organizationInvitations)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(and(eq(organizationInvitations.id, invitation.id), eq(organizationInvitations.status, 'pending')))
      .returning();
    if (!updated) throw new AccessError('NOT_FOUND', 'Invitation does not exist or is not accessible.');
    return updated;
  }

  async requestTeamMembership(userId: string, teamId: string) {
    const [team] = await this.database.select({ id: teams.id, organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
    await this.entitlements.assertCanAddMember(team.organizationId, userId);
    const [request] = await this.database.insert(teamJoinRequests).values({ teamId, userId }).returning();
    return request;
  }

  async listTeamJoinRequests(userId: string, teamId: string) {
    await this.requireTeamManager(userId, teamId);
    return this.database.select({
      id: teamJoinRequests.id,
      teamId: teamJoinRequests.teamId,
      userId: teamJoinRequests.userId,
      email: users.email,
      status: teamJoinRequests.status,
      createdAt: teamJoinRequests.createdAt,
    }).from(teamJoinRequests)
      .innerJoin(users, eq(users.id, teamJoinRequests.userId))
      .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.status, 'pending')));
  }

  async reviewTeamJoinRequest(userId: string, requestId: string, decision: 'approved' | 'rejected') {
    return this.database.transaction(async (tx) => {
      const service = new AccessService(tx as unknown as PostgresJsDatabase, new EntitlementService(tx as unknown as PostgresJsDatabase));
      const [request] = await tx.select().from(teamJoinRequests)
        .where(and(eq(teamJoinRequests.id, requestId), eq(teamJoinRequests.status, 'pending'))).limit(1);
      if (!request) throw new AccessError('NOT_FOUND', 'Join request does not exist.');
      await service.requireTeamManager(userId, request.teamId);
      const [team] = await tx.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, request.teamId)).limit(1);
      if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
      await service.entitlements.assertCanWrite(team.organizationId);

      const [updated] = await tx.update(teamJoinRequests)
        .set({ status: decision, reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(teamJoinRequests.id, requestId), eq(teamJoinRequests.status, 'pending')))
        .returning();
      if (!updated) throw new AccessError('NOT_FOUND', 'Join request does not exist.');
      if (decision === 'approved') {
        await service.entitlements.assertCanAddMember(team.organizationId, request.userId);
        await tx.insert(organizationMemberships).values({ userId: request.userId, organizationId: team.organizationId, role: 'member' }).onConflictDoNothing();
        await tx.insert(teamMemberships).values({ userId: request.userId, teamId: request.teamId, role: 'member' }).onConflictDoNothing();
      }
      return updated;
    });
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

  async listOrganizationMembers(userId: string, organizationId: string) {
    await this.requireOrganizationRole(userId, organizationId, ['owner', 'admin', 'member']);
    return this.database.select({ userId: users.id, email: users.email, displayName: users.displayName, role: organizationMemberships.role })
      .from(organizationMemberships).innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId));
  }

  async listTeamMembers(userId: string, teamId: string) {
    const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
    await this.requireOrganizationRole(userId, team.organizationId, ['owner', 'admin', 'member']);
    return this.database.select({ userId: users.id, email: users.email, displayName: users.displayName, role: teamMemberships.role })
      .from(teamMemberships).innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(eq(teamMemberships.teamId, teamId));
  }

  async getTeamDetails(userId: string, teamId: string) {
    const [team] = await this.database.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
    const organizationRole = await this.organizationRole(userId, team.organizationId);
    const [currentMembership] = await this.database.select({ role: teamMemberships.role }).from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId))).limit(1);
    const isOrganizationAdmin = orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number]);
    if (!isOrganizationAdmin && !currentMembership) throw new AccessError('NOT_FOUND', 'Team does not exist or is not accessible.');
    const members = await this.listTeamMembers(userId, teamId);
    const projectRows = await this.database.select({ id: projects.id }).from(projects).where(eq(projects.teamId, teamId));
    return {
      team,
      members,
      projectsCount: projectRows.length,
      canManage: isOrganizationAdmin || currentMembership?.role === 'lead',
    };
  }

  async updateTeamMember(userId: string, teamId: string, memberId: string, role: 'lead' | 'member') {
    await this.requireTeamManager(userId, teamId);
    const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    await this.entitlements.assertCanWrite(team!.organizationId);
    const [membership] = await this.database.select().from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, memberId))).limit(1);
    if (!membership) throw new AccessError('NOT_FOUND', 'Team member does not exist.');
    if (membership.role === 'lead' && role === 'member') await this.ensureAnotherLead(teamId, memberId);
    const [updated] = await this.database.update(teamMemberships).set({ role, updatedAt: new Date() })
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, memberId))).returning();
    return updated;
  }

  async removeTeamMember(userId: string, teamId: string, memberId: string) {
    await this.requireTeamManager(userId, teamId);
    const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    await this.entitlements.assertCanWrite(team!.organizationId);
    const [membership] = await this.database.select().from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, memberId))).limit(1);
    if (!membership) throw new AccessError('NOT_FOUND', 'Team member does not exist.');
    if (membership.role === 'lead') await this.ensureAnotherLead(teamId, memberId);
    await this.database.delete(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, memberId)));
    return { status: 'removed' as const };
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

  async getProject(userId: string, projectId: string) {
    const [project] = await this.database
      .select({ project: projects, organizationId: teams.organizationId })
      .from(projects)
      .innerJoin(teams, eq(projects.teamId, teams.id))
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new AccessError('NOT_FOUND', 'Project does not exist or is not accessible.');
    const visible = await this.listProjects(project.organizationId, userId);
    const match = visible.find((item) => item.id === project.project.id);
    if (!match) throw new AccessError('NOT_FOUND', 'Project does not exist or is not accessible.');
    return { ...project.project, organizationId: project.organizationId };
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

  private async requireTeamManager(userId: string, teamId: string) {
    const [team] = await this.database.select({ organizationId: teams.organizationId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) throw new AccessError('NOT_FOUND', 'Team does not exist.');
    const organizationRole = await this.organizationRole(userId, team.organizationId);
    if (orgAdminRoles.includes(organizationRole as (typeof orgAdminRoles)[number])) return;
    const [membership] = await this.database.select({ role: teamMemberships.role }).from(teamMemberships).where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId))).limit(1);
    if (membership?.role !== 'lead') throw new AccessError('FORBIDDEN', 'Team manager access is required.');
  }

  private async ensureAnotherLead(teamId: string, memberId: string) {
    const leads = await this.database.select({ userId: teamMemberships.userId }).from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.role, 'lead')));
    if (!leads.some((lead) => lead.userId !== memberId)) {
      throw new AccessError('FORBIDDEN', 'Team must keep at least one lead.');
    }
  }
}

function makeSlug(prefix: string, name: string): string {
  const digest = createHash('sha256').update(name.trim()).digest('hex').slice(0, 8);
  return `${prefix}-${digest}-${randomUUID().slice(0, 8)}`;
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
