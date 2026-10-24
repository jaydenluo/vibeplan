import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';

const apiURL = 'http://localhost:4401';
const password = 'E2E-only-passphrase-123';
type Item = { id: string; title: string; version: number; status: string; acceptanceItems: { id: string; status: string; text: string }[] };
async function call<T = any>(api: APIRequestContext, method: string, path: string, data?: unknown, status = 200): Promise<T> {
  let response = await api.fetch(path, { method, data });
  if (response.status() === 401 && !path.startsWith('/auth/')) {
    const renewal = await api.post('/auth/refresh');
    expect(renewal.ok(), `Refresh: ${renewal.status()} ${await renewal.text()}`).toBe(true);
    response = await api.fetch(path, { method, data });
  }
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  return response.json();
}
async function login(page: Page, email: string, projectId: string, title: string) {
  await page.goto(`/projects/${projectId}`);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await openTask(page, title);
}
async function openTask(page: Page, title: string) {
  await page.getByRole('button', { name: new RegExp(`^${title} `) }).click();
  await page.getByRole('tab', { name: '任务详情', exact: true }).click();
  await expect(page.getByRole('heading', { name: '交付与验收', exact: true })).toBeVisible();
}

test('isolated two-member lifecycle, permission failures, rejection, acceptance and browser refresh', async ({ browser }) => {
  const suffix = randomUUID();
  const leadEmail = `e2e-lead-${suffix}@example.com`;
  const memberEmail = `e2e-member-${suffix}@example.com`;
  const lead = await request.newContext({ baseURL: apiURL });
  const member = await request.newContext({ baseURL: apiURL });
  let orgId: string | undefined;
  const userIds: string[] = [];
  const leadBrowser = await browser.newContext();
  const memberBrowser = await browser.newContext();
  try {
    for (const [api, email, displayName] of [[lead, leadEmail, 'E2E Reviewer'], [member, memberEmail, 'E2E Contributor']] as const) {
      const user = await call(api, 'POST', '/auth/register', { email, password, displayName }, 201);
      userIds.push(user.id);
      await call(api, 'POST', '/auth/login', { email, password });
    }
    const org = await call(lead, 'POST', '/organizations', { name: `E2E ${suffix}` }, 201); orgId = org.id;
    const team = await call(lead, 'POST', `/organizations/${org.id}/teams`, { name: 'Lifecycle' }, 201);
    const invitation = await call(lead, 'POST', `/organizations/${org.id}/invitations`, { email: memberEmail, teamId: team.id }, 201);
    await call(member, 'POST', `/invitations/${invitation.id}/accept`);
    const project = await call(lead, 'POST', `/teams/${team.id}/projects`, { name: 'Isolated lifecycle' }, 201);
    let item = await call<Item>(lead, 'POST', `/projects/${project.id}/work-items`, {
      title: `E2E task ${suffix}`, description: 'Isolated lifecycle evidence', type: 'improvement', status: 'backlog', priority: 'P1', estimate: 1,
      assigneeId: userIds[1], acceptanceCriteria: ['Browser and API agree', 'Review permissions enforced'],
    }, 201);
    const path = `/work-items/${item.id}`;
    const patch = async (api: APIRequestContext, data: unknown) => item = await call<Item>(api, 'PATCH', path, { version: item.version, ...data as object });
    await patch(member, { planMarkdown: '# Plan\nImplement, test, hand off, review.' });
    await patch(member, { status: 'ready' });
    const oldVersion = item.version;
    await patch(member, { status: 'in_progress' });
    await call(member, 'PATCH', path, { version: oldVersion, progress: 50 }, 409);
    await patch(member, { progress: 45, executionStage: 'testing', executionNote: 'Tests in progress' });
    await patch(member, { assigneeId: userIds[0], changeReason: 'Hand off reproduction to reviewer' });
    await patch(lead, { assigneeId: userIds[1], changeReason: 'Reproduction confirmed; contributor repairs' });
    item = await call<Item>(member, 'POST', `${path}/report`, { version: item.version, summary: 'Reproduction fails', outcome: 'failed', tests: [{ command: 'e2e', result: 'failed' }], remainingIssues: ['Repair regression'] });
    expect(item.status).toBe('in_progress');
    await call(lead, 'POST', `${path}/accept`, { version: item.version, decision: 'approved' }, 400);
    await call(member, 'PATCH', path, { version: item.version, status: 'in_review' }, 400);
    await patch(member, { progress: 80, executionStage: 'implementation', executionNote: 'Regression repaired' });
    item = await call<Item>(member, 'POST', `${path}/report`, { version: item.version, summary: 'Repaired and verified', outcome: 'success', changedFiles: ['example.ts'], tests: [{ command: 'e2e', result: 'passed' }], criterionResults: item.acceptanceItems.map((criterion) => ({ acceptanceItemId: criterion.id, result: 'passed', evidence: [] })) });
    expect(item.status).toBe('in_review');
    await call(member, 'POST', `${path}/accept`, { version: item.version, decision: 'approved' }, 404);
    await call(member, 'PATCH', `${path}/acceptance-items/${item.acceptanceItems[0].id}`, { version: item.version, status: 'passed' }, 404);
    await call(lead, 'POST', `${path}/accept`, { version: item.version, decision: 'approved' }, 400);
    await call(lead, 'POST', `${path}/accept`, { version: item.version, decision: 'rejected', comment: '' }, 400);

    const memberPage = await memberBrowser.newPage();
    await login(memberPage, memberEmail, project.id, item.title);
    await expect(memberPage.getByText('等待有审核权限的成员验收。')).toBeVisible();
    await expect(memberPage.getByRole('button', { name: '批准完成' })).toHaveCount(0);
    const leadPage = await leadBrowser.newPage();
    await login(leadPage, leadEmail, project.id, item.title);
    await leadPage.getByRole('button', { name: '退回修改' }).click();
    await expect(leadPage.getByText('请填写退回原因。')).toBeVisible();
    await leadPage.getByLabel('验收说明 / 退回原因').fill('Add regression evidence');
    await leadPage.getByRole('button', { name: '退回修改' }).click();
    await expect(leadPage.getByLabel('执行说明', { exact: true })).toBeVisible();
    item = await call<Item>(lead, 'GET', path);
    expect(item.status).toBe('in_progress');
    await memberPage.reload();
    await openTask(memberPage, item.title);
    await memberPage.getByLabel('执行说明', { exact: true }).fill('Regression evidence added and browser verified');
    await memberPage.getByLabel('改动文件', { exact: true }).fill('example.ts');
    await memberPage.getByRole('button', { name: '添加测试', exact: true }).click();
    await memberPage.getByLabel('测试命令 1', { exact: true }).fill('isolated-fixture-check');
    await memberPage.getByLabel('测试结果 1', { exact: true }).fill('Fixture regression verified');
    await memberPage.getByLabel('测试状态 1', { exact: true }).selectOption('passed');
    await memberPage.getByLabel('退出码 1', { exact: true }).fill('0');
    await memberPage.reload();
    await openTask(memberPage, item.title);
    await expect(memberPage.getByLabel('执行说明', { exact: true })).toHaveValue('Regression evidence added and browser verified');
    await expect(memberPage.getByLabel('测试命令 1', { exact: true })).toHaveValue('isolated-fixture-check');
    await memberPage.getByRole('button', { name: '提交执行报告', exact: true }).click();
    await expect(memberPage.getByText('等待有审核权限的成员验收。')).toBeVisible();
    item = await call<Item>(lead, 'GET', path);
    await leadPage.reload();
    await openTask(leadPage, item.title);
    for (const criterion of item.acceptanceItems) {
      await leadPage.getByLabel(`验收状态 ${criterion.text}`, { exact: true }).selectOption('passed');
      await leadPage.getByLabel(`验收评论 ${criterion.text}`, { exact: true }).fill('Verified in isolated E2E browser');
      const saved = leadPage.waitForResponse((response) => response.url().endsWith(`${path}/acceptance-items/${criterion.id}`) && response.status() === 200);
      await leadPage.getByRole('button', { name: `保存验收项 ${criterion.text}`, exact: true }).click();
      item = await (await saved).json();
      expect(item.acceptanceItems.find((entry) => entry.id === criterion.id)?.status).toBe('passed');
    }
    // Remove only access cookie: HttpOnly refresh cookie proves browser recovery twice.
    for (let rotation = 0; rotation < 2; rotation++) {
      await leadBrowser.clearCookies({ name: 'vibe_access' });
      await leadPage.reload();
      await openTask(leadPage, item.title);
      await expect(leadPage.getByRole('button', { name: '批准完成' })).toBeVisible();
    }
    await leadPage.getByRole('button', { name: '批准完成' }).click();
    await expect(leadPage.getByText('已完成验收。若需更改验收标准或结论，请先重新打开任务。')).toBeVisible();
    item = await call<Item>(lead, 'GET', path); expect(item.status).toBe('done');
    const history = await call<any[]>(lead, 'GET', `${path}/events`);
    expect(history.filter((event) => event.action === 'report')).toHaveLength(3);
    expect(JSON.stringify(history)).toContain('Hand off reproduction');
    expect(JSON.stringify(history)).toContain('Add regression evidence');
    const blocker = await call<Item>(lead, 'POST', `/projects/${project.id}/work-items`, { title: 'Unfinished dependency', type: 'chore', status: 'backlog', priority: 'P2', estimate: 1 }, 201);
    const dependent = await call<Item>(lead, 'POST', `/projects/${project.id}/work-items`, { title: 'Dependent', type: 'chore', status: 'ready', priority: 'P2', estimate: 1, dependsOn: [blocker.id] }, 201);
    await call(lead, 'PATCH', `/work-items/${dependent.id}`, { version: dependent.version, status: 'in_progress' }, 400);
  } finally {
    await Promise.allSettled([leadBrowser.close(), memberBrowser.close(), lead.dispose(), member.dispose()]);
    // Only this fixture's UUID-owned records, never truncate shared test data.
    const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
    const sql = require('postgres')('postgres://vibe:vibe@localhost:5433/vibe_plan_test', { onnotice: () => undefined });
    try {
      if (orgId) await sql`delete from organizations where id=${orgId}`;
      for (const userId of userIds) await sql`delete from users where id=${userId}`;
    } finally { await sql.end(); }
  }
});
