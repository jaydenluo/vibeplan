import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { ApiClient } from '../api-client.js';

function context() {
  const config = loadProjectConfig();
  if (!config) throw new Error('Run `vibe init --project-id ID` in a project directory first.');
  return config;
}

export async function listTasks(): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = context();
  const items = await new ApiClient(session.server, session).workItems(config.projectId);
  console.log(JSON.stringify(items, null, 2));
}

export async function startTask(id: string, version: number): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const result = await new ApiClient(session.server, session).updateWorkItem(id, version, { status: 'in_progress' });
  console.log(JSON.stringify(result, null, 2));
}

export async function reportTask(id: string, version: number, summary: string): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const result = await new ApiClient(session.server, session).updateWorkItem(id, version, { status: 'in_review', description: summary });
  console.log(JSON.stringify(result, null, 2));
}
