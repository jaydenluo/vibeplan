import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { ApiClient } from '../api-client.js';
import { submitMutation, outboxOrigin } from '../sync/outbox.js';

export type TaskCreateOptions = {
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate?: string;
  estimate: string;
  description: string;
  acceptance: string[];
};

export function buildTaskCreatePayload(options: TaskCreateOptions) {
  const acceptanceCriteria = options.acceptance.map((criterion) => criterion.trim()).filter(Boolean);
  if (!options.title.trim()) throw new Error('Task title is required.');
  if (!options.description.trim()) throw new Error('Task description is required.');
  if (acceptanceCriteria.length === 0) throw new Error('At least one acceptance criterion is required.');
  const estimate = Number(options.estimate);
  if (!Number.isInteger(estimate) || estimate < 1) throw new Error('Estimate must be a positive integer.');
  return {
    title: options.title.trim(),
    type: options.type,
    status: options.status,
    priority: options.priority,
    dueDate: options.dueDate?.trim() || null,
    estimate,
    description: options.description.trim(),
    acceptanceCriteria,
  };
}

export async function createTask(options: TaskCreateOptions): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = loadProjectConfig();
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  const input = buildTaskCreatePayload(options);
  const item = await submitMutation({ type: 'work-item.create', payload: { projectId: config.projectId, input }, origin: outboxOrigin(session) }, (event) => new ApiClient(session.server, session).createWorkItem(config.projectId, input, event.id));
  console.log(JSON.stringify(item, null, 2));
}
