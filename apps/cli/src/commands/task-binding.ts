import { ApiClient, normalizeServer } from '../api-client.js';
import { loadSession } from '../auth.js';
import { loadProjectConfig } from '../config.js';

export type BoundTask = { id: string; projectId: string; version: number };

export async function boundTask(id: string): Promise<{ client: ApiClient; item: BoundTask; session: NonNullable<Awaited<ReturnType<typeof loadSession>>> }> {
  const config = loadProjectConfig();
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  if (normalizeServer(session.server) !== normalizeServer(config.server)) throw new Error('Login server differs from the initialized project server.');
  const client = new ApiClient(session.server, session);
  const item = await client.workItem(id);
  if (item.projectId !== config.projectId) throw new Error('Task does not belong to the initialized project.');
  return { client, item, session };
}
