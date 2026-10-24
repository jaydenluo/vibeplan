import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [installation, taskRoot] = process.argv.slice(2);
const apiURL = process.env.VIBEPLAN_PACKED_API;
assert.equal(apiURL, 'http://localhost:4401');
const require = createRequire(`${installation}/node_modules/@vibeplan/cli/package.json`);
// Replace every keychain method before importing any packed command. No native
// keychain call occurs; credentials exist only in this isolated child process.
const keytar = require('keytar');
let session;
keytar.getPassword = async () => session ? JSON.stringify(session) : null;
keytar.setPassword = async (_service, _account, value) => { session = JSON.parse(value); };
keytar.deletePassword = async () => { session = undefined; return true; };
process.chdir(taskRoot);
const packed = (file) => import(pathToFileURL(`${installation}/node_modules/@vibeplan/cli/dist/${file}`).href);
const { ApiClient } = await packed('api-client.js');
const { startTask, reportTask, logTask } = await packed('commands/task.js');
const { uploadTaskPlan, updateTaskProgress, readReportFile } = await packed('commands/execution.js');
const { taskContext, updateTask, buildTaskContext } = await packed('commands/maintenance.js');
const { writeProjectConfig } = await packed('config.js');
const outbox = await packed('sync/outbox.js');
const suffix = randomUUID();
const email = `e2e-packed-${suffix}@example.com`;
const password = 'Packed-only-password123';
let userId;
let orgId;
let browserCookie = '';
const raw = async (method, path, data, auth = true) => {
  const response = await fetch(`${apiURL}${path}`, { method, headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(auth ? { cookie: browserCookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (path === '/auth/login') browserCookie = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
};
// Refresh sessions before packed calls keeps the short fixture TTL valid;
// refresh-lock behavior is verified separately by native and CLI auth tests.
async function authenticate() {
  await raw('POST', '/auth/login', { email, password }, false);
  const device = await raw('POST', '/auth/device/start', undefined, false);
  await raw('POST', '/auth/device/approve', { userCode: device.userCode });
  const issued = await raw('POST', '/auth/device/exchange', { deviceCode: device.deviceCode }, false);
  session = { ...issued, server: 'http://localhost:4403' };
  return new ApiClient(session.server, session);
}
try {
  const user = await raw('POST', '/auth/register', { email, password, displayName: 'Packed CLI test' }, false); userId = user.id;
  await authenticate();
  const org = await raw('POST', '/organizations', { name: `E2E packed ${suffix}` }); orgId = org.id;
  const team = await raw('POST', `/organizations/${org.id}/teams`, { name: 'Packed fixture' });
  const project = await raw('POST', `/teams/${team.id}/projects`, { name: 'Packed isolated commands' });
  writeProjectConfig({ server: 'http://localhost:4403', projectId: project.id, teamId: team.id, organizationId: org.id }, taskRoot);
  let item = await raw('POST', `/projects/${project.id}/work-items`, { title: 'Packed workflow', type: 'chore', status: 'ready', priority: 'P2', estimate: 1, acceptanceCriteria: ['Packed report survives lost response'] });
  const getItem = async () => (await authenticate()).workItem(item.id);
  await authenticate(); await uploadTaskPlan(item.id, item.version, '# Packed plan\nReal isolated API validation'); item = await getItem();
  await authenticate(); await startTask(item.id, item.version); item = await getItem(); assert.equal(item.status, 'in_progress');
  await authenticate(); await updateTaskProgress(item.id, item.version, 45, 'testing', 'Packed mutation workflow'); item = await getItem();
  await authenticate(); await taskContext(item.id);
  await authenticate(); await updateTaskProgress(item.id, item.version, 45, 'blocked', 'Waiting for fixture API; owner: test team'); item = await getItem(); assert.equal(item.status, 'blocked');
  const patchPath = `${taskRoot}/patch.json`;
  writeFileSync(patchPath, JSON.stringify({ status: 'in_progress', executionStage: 'implementation', executionNote: 'Fixture API dependency resolved' }));
  await authenticate(); await updateTask(item.id, item.version, patchPath); item = await getItem(); assert.equal(item.status, 'in_progress');
  await authenticate(); await logTask(item.id, 0.5, 'Real packed command fixture', '2026-10-05'); item = await getItem(); assert.equal(Number(item.actualHours), 0.5);
  const reportPath = `${taskRoot}/report.json`;
  writeFileSync(reportPath, JSON.stringify({ summary: 'Packed report passed', outcome: 'success', tests: [{ command: 'packed workflow fixture', result: 'passed', outcome: 'passed', exitCode: 0 }], criterionResults: item.acceptanceItems.map((criterion) => ({ acceptanceItemId: criterion.id, result: 'Verified from packed command', evidence: [] })) }));
  const parsed = readReportFile(reportPath);
  const client = await authenticate();
  const reportVersion = item.version;
  const originalFetch = globalThis.fetch;
  let lostResponse = false;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (!lostResponse && String(args[0]).endsWith(`/work-items/${item.id}/report`) && response.ok) {
      lostResponse = true;
      await response.arrayBuffer();
      throw new TypeError('Isolated fixture drops response after server commits');
    }
    return response;
  };
  try { await assert.rejects(reportTask(item.id, reportVersion, parsed.summary, parsed.options), /drops response/); }
  finally { globalThis.fetch = originalFetch; }
  const queued = outbox.listOutbox(taskRoot);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].retryCount, 1);
  assert.equal(queued[0].type, 'work-item.report');
  // Retry the exact persisted id and stale version against the actual API.
  const retryClient = await authenticate();
  const recovered = await retryClient.reportWorkItem(item.id, queued[0].payload.report, queued[0].id);
  assert.equal(recovered.status, 'in_review');
  assert.equal(recovered.version, reportVersion + 1);
  outbox.removeOutbox(queued[0].id, taskRoot);
  assert.equal(outbox.listOutbox(taskRoot).length, 0);
  const events = await retryClient.workItemEvents(item.id);
  assert.equal(events.filter((event) => event.action === 'report').length, 1);
  assert.equal(events.filter((event) => event.action === 'work_log').length, 1);
  item = await getItem();
  const criterion = item.acceptanceItems[0];
  item = await raw('PATCH', `/work-items/${item.id}/acceptance-items/${criterion.id}`, { version: item.version, status: 'failed', comment: 'Packed repair: fixture review failed', evidence: [] });
  item = await raw('POST', `/work-items/${item.id}/accept`, { version: item.version, decision: 'rejected', comment: 'Repair the original task' });
  item = await getItem();
  const context = buildTaskContext(item);
  assert.equal(context.repairPending, true);
  assert.equal(context.currentReport, null);
  assert.equal(context.repairFeedback[0].comment, 'Packed repair: fixture review failed');
  assert.equal(item.acceptanceItems[0].status, 'unverified');
  console.log('Packed authenticated API workflow passed');
} finally {
  // Exact UUID-created records in the fixed test DB only.
  const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
  const sql = apiRequire('postgres')('postgres://vibe:vibe@localhost:5433/vibe_plan_test', { onnotice: () => undefined });
  try {
    if (orgId) await sql`delete from organizations where id=${orgId}`;
    if (userId) await sql`delete from users where id=${userId}`;
  } finally { await sql.end(); }
}
