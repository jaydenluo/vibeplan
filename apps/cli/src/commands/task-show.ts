import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { ApiClient } from '../api-client.js';

export async function showTask(id: string): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = loadProjectConfig();
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  const item = await new ApiClient(session.server, session).workItem(id);
  if (item.projectId !== config.projectId) throw new Error('Task does not belong to the initialized project.');
  console.log(JSON.stringify(item, null, 2));
}
