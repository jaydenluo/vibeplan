import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { organizationMemberships, projects, teamMemberships, teams } from '../db/schema.js';

export async function listProjectsForUser(
  database: PostgresJsDatabase,
  userId: string,
  organizationId: string,
) {
  return database
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      repositoryUrl: projects.repositoryUrl,
      teamId: projects.teamId,
    })
    .from(projects)
    .innerJoin(teams, eq(projects.teamId, teams.id))
    .innerJoin(teamMemberships, and(eq(teamMemberships.teamId, teams.id), eq(teamMemberships.userId, userId)))
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, teams.organizationId),
        eq(organizationMemberships.userId, userId),
      ),
    )
    .where(eq(teams.organizationId, organizationId))
    .orderBy(asc(projects.createdAt));
}
