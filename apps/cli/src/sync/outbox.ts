import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isRetryableApiError, normalizeServer, UnsupportedCapabilityError } from '../api-client.js';
import { sessionActorId } from '../session-identity.js';

export type OutboxOrigin = { server: string; actorId?: string };
type OutboxInput = { type: string; payload: Record<string, unknown>; origin?: OutboxOrigin };
export type OutboxEvent = { id: string; type: string; payload: Record<string, unknown>; origin?: OutboxOrigin; createdAt: string; retryCount: number; paused?: boolean; lastError?: string };
export function outboxOrigin(session: { server: string; accessToken: string; actorId?: string }): OutboxOrigin {
  return { server: normalizeServer(session.server), actorId: sessionActorId(session) };
}

export async function submitMutation<T>(input: OutboxInput, send: (event: OutboxEvent) => Promise<T>, root = process.cwd()): Promise<T> {
  const event = enqueueOutbox(input, root);
  try { const result = await send(event); removeOutbox(event.id, root); return result; }
  catch (error) {
    if (error instanceof UnsupportedCapabilityError) updateOutbox({ ...event, paused: true, lastError: error.message }, root);
    else if (!isRetryableApiError(error)) removeOutbox(event.id, root);
    else updateOutbox({ ...event, retryCount: 1, lastError: error instanceof Error ? error.message : String(error) }, root);
    throw error;
  }
}

export function discardPausedOutbox(id: string, root = process.cwd()): void {
  const event = listOutbox(root).find((candidate) => candidate.id === id);
  if (!event) throw new Error('Queued event not found.');
  if (!event.paused) throw new Error('Only a paused event can be discarded.');
  removeOutbox(id, root);
}

export function enqueueOutbox(input: OutboxInput, root = process.cwd()): OutboxEvent {
  const latest = listOutbox(root).reduce((value, event) => Math.max(value, Date.parse(event.createdAt) || 0), 0);
  const event: OutboxEvent = { id: randomUUID(), type: input.type, payload: input.payload, ...(input.origin ? { origin: input.origin } : {}), createdAt: new Date(Math.max(Date.now(), latest + 1)).toISOString(), retryCount: 0 };
  const directory = join(root, '.vibe', 'outbox');
  const target = join(directory, `${event.createdAt.replace(/[:.]/g, '-')}-${event.id}.json`);
  const temporary = `${target}.tmp`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(temporary, JSON.stringify(event, null, 2), 'utf8');
  renameSync(temporary, target);
  return event;
}

export function listOutbox(root = process.cwd()): OutboxEvent[] {
  const directory = join(root, '.vibe', 'outbox');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => file.endsWith('.json')).sort().map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as OutboxEvent);
}

export function removeOutbox(id: string, root = process.cwd()): void {
  const directory = join(root, '.vibe', 'outbox');
  if (!existsSync(directory)) return;
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const path = join(directory, file);
    const event = JSON.parse(readFileSync(path, 'utf8')) as OutboxEvent;
    if (event.id === id) unlinkSync(path);
  }
}

export function updateOutbox(event: OutboxEvent, root = process.cwd()): void {
  const directory = join(root, '.vibe', 'outbox');
  if (!existsSync(directory)) return;
  const file = readdirSync(directory).find((name) => name.endsWith('.json') && JSON.parse(readFileSync(join(directory, name), 'utf8')).id === event.id);
  if (!file) return;
  const target = join(directory, file);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(event, null, 2), 'utf8');
  renameSync(temporary, target);
}
