import { loadProjectConfig } from '../config.js';
import { loadSession } from '../auth.js';
import { ApiClient, ApiRequestError, UnsupportedCapabilityError } from '../api-client.js';
import { archiveTaskMirror, managedMirrorIds, writeTaskMirror, type TaskMirror } from '../sync/task-mirror.js';
import { listOutbox, removeOutbox, updateOutbox, outboxOrigin, type OutboxEvent } from '../sync/outbox.js';
import { AuthenticationRequiredError } from '../errors.js';
import { daemonLog as log, readSyncState, writeSyncState } from '../sync/state.js';

export async function flushOutbox(root = process.cwd()): Promise<{ sent: number; failed: number }> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = loadProjectConfig(root);
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  const client = new ApiClient(session.server, session);
  const currentOrigin = outboxOrigin(session);
  let sent = 0;
  let failed = 0;
  const events = listOutbox(root);
  const key = (event: OutboxEvent) => String(event.payload.id ?? event.id);
  const blocked = new Set(events.filter((event) => event.paused).map(key));
  for (const event of events) {
    const taskId = key(event);
    if (event.paused) { blocked.add(taskId); continue; }
    if (blocked.has(taskId)) continue;
    const origin = event.origin;
    if (!origin?.actorId || !currentOrigin.actorId || origin.server !== currentOrigin.server || origin.actorId !== currentOrigin.actorId) {
      const lastError = !origin?.actorId ? 'Cannot verify legacy outbox origin. Check the original account/server and whether it already committed; inspect sync:pending, then sync:discard before submitting a verified replacement.' : 'Queued operation belongs to another account/server. Run vibeplan login for the original account/server; inspect sync:pending before discarding or replacing it.';
      updateOutbox({ ...event, paused: true, lastError }, root);
      blocked.add(taskId); failed += 1; log(root, `outbox paused ${event.id}: ${lastError}`);
      continue;
    }
    try {
      if (event.type === 'work-item.create') {
        await client.createWorkItem(String(event.payload.projectId), event.payload.input as Record<string, unknown>, event.id);
      } else if (event.type === 'work-item.update') {
        const payload = event.payload as { id: string; version: number; patch: Record<string, unknown> };
        await client.updateWorkItem(payload.id, payload.version, payload.patch, event.id);
      } else if (event.type === 'work-item.report') {
        const payload = event.payload as { id: string; report: Record<string, unknown> };
        await client.reportWorkItem(payload.id, payload.report, event.id);
      } else if (event.type === 'work-item.accept') {
        const payload = event.payload as { id: string; acceptance: Record<string, unknown> };
        await client.acceptWorkItem(payload.id, payload.acceptance, event.id);
      } else if (event.type === 'work-item.log') {
        await client.logWorkItem(taskId, event.payload.log as Record<string, unknown>, event.id);
      } else if (event.type === 'work-item.log.correct') {
        await client.correctWorkLog(taskId, String(event.payload.logId), event.payload.log as Record<string, unknown>, event.id);
      } else if (event.type === 'work-item.log.withdraw') {
        await client.withdrawWorkLog(taskId, String(event.payload.logId), event.payload.log as Record<string, unknown>, event.id);
      } else {
        log(root, `ignored unknown outbox event ${event.type} (${event.id})`);
        continue;
      }
      removeOutbox(event.id, root);
      sent += 1;
    } catch (error) {
      blocked.add(taskId);
      failed += 1;
      const message = error instanceof AuthenticationRequiredError ? 'Authentication expired. Run vibeplan login for the original account/server; inspect sync:pending and confirm the result before discarding or replacing this operation.' : error instanceof Error ? error.message : 'Unknown synchronization error';
      const paused = error instanceof AuthenticationRequiredError || error instanceof UnsupportedCapabilityError || (error instanceof ApiRequestError && error.status >= 400 && error.status < 500);
      const next: OutboxEvent = { ...event, retryCount: event.retryCount + 1, paused, lastError: message };
      updateOutbox(next, root);
      if (paused) log(root, `outbox paused ${event.id}: inspect task:show and resolve the error; then discard the old event with vibeplan sync:discard ${event.id} before submitting a replacement`);
      log(root, `outbox retry ${next.retryCount} for ${event.id}: ${message}`);
      if (/conflict|changed since|409/i.test(message)) log(root, `version conflict retained for ${event.id}`);
    }
  }
  return { sent, failed };
}

export async function syncTasks(root = process.cwd()): Promise<void> {
  const session = await loadSession();
  if (!session) throw new Error('Not logged in.');
  const config = loadProjectConfig(root);
  if (!config) throw new Error('Run `vibeplan init --project-id ID` in a project directory first.');
  const client = new ApiClient(session.server, session);
  const previous = readSyncState(root);
  const state = previous.projectId === config.projectId && previous.server === session.server ? previous : {};
  try {
    const info = await client.serverInfo();
    const full = !state.cursor || !state.lastFullAt || Date.now() - Date.parse(state.lastFullAt) > 60 * 60 * 1000;
    let items: TaskMirror[] = [];
    let cursor = full ? undefined : state.cursor;
    let reset = full;
    const deleted = new Set<string>();
    if (info.capabilities.includes('incremental-sync') || info.capabilities.includes('sync-feed')) {
      let more = true;
      while (more) {
        let page;
        try { page = await client.sync(config.projectId, cursor); }
        catch (error) {
          if (!(error instanceof ApiRequestError) || error.status !== 409 || error.code !== 'SYNC_RESET_REQUIRED' || cursor === undefined) throw error;
          cursor = undefined; items = []; deleted.clear(); reset = true;
          page = await client.sync(config.projectId);
        }
        items.push(...page.items as TaskMirror[]); page.deletedIds.forEach((id) => deleted.add(id));
        reset ||= Boolean(page.reset);
        if (page.hasMore && page.cursor === cursor) throw new Error('Synchronization cursor did not advance.');
        cursor = page.cursor; more = page.hasMore;
      }
    } else { items = await client.workItems(config.projectId) as TaskMirror[]; reset = true; cursor = undefined; }
    const managed = new Set(reset ? [] : state.managedIds ?? []);
    for (const item of items) { writeTaskMirror(item, root); managed.add(item.id); }
    if (reset) for (const id of new Set([...(state.managedIds ?? []), ...managedMirrorIds(root)])) if (!managed.has(id)) deleted.add(id);
    for (const id of deleted) { archiveTaskMirror(id, root); managed.delete(id); }
    writeSyncState({ projectId: config.projectId, server: session.server, cursor, managedIds: [...managed], lastFullAt: reset ? new Date().toISOString() : state.lastFullAt, lastSuccessAt: new Date().toISOString(), count: managed.size }, root);
    console.log(`Synchronized ${items.length} task(s).`);
  } catch (error) {
    writeSyncState({ ...state, projectId: config.projectId, server: session.server, error: error instanceof Error ? error.message : String(error) }, root);
    throw error;
  }
}

export async function inspectPending(root = process.cwd()) {
  const events = listOutbox(root);
  const session = await loadSession();
  if (!session) return events;
  const client = new ApiClient(session.server, session);
  return Promise.all(events.map(async (event) => {
    if (!event.paused) return event;
    try {
      const current = await client.workItem(String(event.payload.id)) as unknown as Record<string, unknown>;
      const desired = (event.payload.patch ?? event.payload.report ?? event.payload.acceptance ?? {}) as Record<string, unknown>;
      const differences = Object.entries(desired).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)).map(([field, requested]) => ({ field, current: current[field], requested }));
      return { ...event, taskTitle: current.title, currentVersion: current.version, differences };
    } catch (error) { return { ...event, inspectionError: error instanceof Error ? error.message : String(error) }; }
  }));
}
