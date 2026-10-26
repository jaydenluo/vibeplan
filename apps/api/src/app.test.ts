import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { db, sqlClient } from './db/client.js';
import { migrate } from './db/migrate.js';
import { AuthService, type Mailer } from './modules/auth/service.js';
import { AccessService } from './modules/access/service.js';
import { PlatformAdminService } from './modules/admin/service.js';
import { EmailDeliveryError } from './modules/mail/mailer.js';
import { WorkItemService } from './modules/work-items/service.js';

class TestMailer implements Mailer {
  isConfigured(): boolean { return true; }
  assertConfigured(): void {}

  async sendRegistrationCode(): Promise<void> {}
  async sendVerification(): Promise<void> {}
  async sendPasswordReset(): Promise<void> {}
}

class UnavailableMailer implements Mailer {
  isConfigured(): boolean { return false; }
  assertConfigured(): void { throw new EmailDeliveryError('EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured.'); }

  async sendRegistrationCode(): Promise<void> {
    throw new EmailDeliveryError('EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured.');
  }

  async sendVerification(): Promise<void> {
    throw new EmailDeliveryError('EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured.');
  }

  async sendPasswordReset(): Promise<void> {
    throw new EmailDeliveryError('EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured.');
  }
}

describe('api app', () => {
  const email = `api-${randomUUID()}@example.com`;
  const password = 'correct horse battery staple';
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  const authService = new AuthService(db, new TestMailer(), { accessSecret: 'test-secret', emailVerificationRequired: false });

  beforeAll(async () => {
    await migrate();
    app = await buildApp({ authService, platformAdminService: new PlatformAdminService(db, { bootstrapEmails: [email] }) });
  });

  afterAll(async () => {
    await app.close();
    await sqlClient`delete from platform_audit_logs where actor_id = ${userId}`;
    await sqlClient`delete from platform_admins where user_id = ${userId}`;
    await sqlClient`delete from users where email = ${email}`;
  });

  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports build metadata and incremental/structured capabilities', async () => {
    const response = await app.inject({ method: 'GET', url: '/version' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ version: expect.any(String), buildCommit: expect.any(String), protocolVersion: 1, capabilities: expect.arrayContaining(['mutation-id', 'sync-feed', 'structured-tests']) });
  });

  it('preserves rate-limit status rather than reporting an internal server error', async () => {
    const limited = await buildApp({ authService, rateLimitMax: 1 });
    try {
      expect((await limited.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      const blocked = await limited.inject({ method: 'GET', url: '/health' });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.message).toContain('Rate limit');
    } finally { await limited.close(); }
  });

  it('returns 401 for an invalid refresh token', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: 'invalid-token' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('registers a user through HTTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password, displayName: '测试用户' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().email).toBe(email);
    expect(response.json().displayName).toBe('测试用户');
    userId = response.json().id;
  });

  it('returns a validation error instead of a server error for invalid input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: `invalid-${randomUUID()}@example.com`, password: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('exposes platform administrator identity from the protected API', async () => {
    const token = (await authService.login(email, password)).accessToken;
    const response = await app.inject({ method: 'GET', url: '/admin/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ userId, email, role: 'super_admin' });
  });

  it('returns rotated credentials to CLI refresh requests while cookie refresh stays cookie-only', async () => {
    const initial = await authService.login(email, password);
    const renewed = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: initial.refreshToken } });
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json()).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(renewed.json().refreshToken).not.toBe(initial.refreshToken);
    const next = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: renewed.json().refreshToken } });
    expect(next.statusCode).toBe(200);
    const browser = await app.inject({ method: 'POST', url: '/auth/refresh', cookies: { vibe_refresh: next.json().refreshToken } });
    expect(browser.statusCode).toBe(200);
    expect(browser.json().accessToken).toBeUndefined();
    expect(browser.json().refreshToken).toBeUndefined();
    expect(browser.headers['set-cookie']).toBeTruthy();
  });

  it('records a criterion review through HTTP', async () => {
    const access = new AccessService(db);
    const organization = await access.createOrganization(userId, `Acceptance API ${randomUUID()}`);
    const team = await access.createTeam(userId, organization.id, 'Core');
    const project = await access.createProject(userId, team.id, 'Acceptance API Project', 'https://example.com/api.git');
    const token = (await authService.login(email, password)).accessToken;
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/work-items`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Review task', description: '', type: 'feature', status: 'ready', priority: 'P1', acceptanceCriteria: ['健康检查返回 200'], dueDate: null, estimate: 1 },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json();
    const response = await app.inject({
      method: 'PATCH',
      url: `/work-items/${item.id}/acceptance-items/${item.acceptanceItems[0].id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { version: item.version, status: 'passed', comment: '已通过健康检查', evidence: [{ label: 'health', url: 'https://example.com/health' }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().acceptanceItems[0]).toMatchObject({
      status: 'passed', comment: '已通过健康检查', reviewedBy: userId, evidence: [{ label: 'health', url: 'https://example.com/health' }],
    });
    expect(response.json().acceptanceItems[0].reviewedAt).toEqual(expect.any(String));
    await sqlClient`delete from organizations where id = ${organization.id}`;
  });

  it('returns an action-oriented overview for the authenticated user\'s visible organization projects', async () => {
    const access = new AccessService(db);
    const organization = await access.createOrganization(userId, `Overview API ${randomUUID()}`);
    const team = await access.createTeam(userId, organization.id, '工作台');
    const project = await access.createProject(userId, team.id, '组织总览项目');
    const workItems = new WorkItemService(db);
    await workItems.create(userId, project.id, { title: '准备发布', description: '', type: 'feature', status: 'ready', priority: 'P1', acceptanceCriteria: [], dueDate: null, estimate: 2 });
    const token = (await authService.login(email, password)).accessToken;

    const response = await app.inject({ method: 'GET', url: `/organizations/${organization.id}/overview`, headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      summary: { projectCount: 1, taskCount: 1, averageProgress: 0, inProgressCount: 0, inReviewCount: 0, blockedCount: 0, overdueCount: 0 },
      statusDistribution: expect.arrayContaining([{ status: 'ready', count: 1 }]),
      projects: [expect.objectContaining({ id: project.id, name: '组织总览项目', progress: 0, risk: 'stable' })],
    });
    const personal = await app.inject({ method: 'GET', url: `/organizations/${organization.id}/my-work`, headers: { authorization: `Bearer ${token}` } });
    expect(personal.statusCode).toBe(200);
    expect(personal.json()).toMatchObject({ inProgress: expect.any(Array), ready: expect.any(Array), blocked: expect.any(Array), inReview: expect.any(Array) });
    expect(personal.json()).toHaveProperty('next');
    await sqlClient`delete from organizations where id = ${organization.id}`;
  });

  it.each([{ planCode: 'team_10', amountCents: 48000 }, { planCode: 'personal', amountCents: 12800 }])('creates and confirms a $planCode billing order through HTTP', async ({ planCode, amountCents }) => {
    const access = new AccessService(db);
    const organization = await access.createOrganization(userId, `Billing API ${randomUUID()}`);
    const token = (await authService.login(email, password)).accessToken;
    const created = await app.inject({
      method: 'POST',
      url: `/organizations/${organization.id}/billing/orders`,
      headers: { authorization: `Bearer ${token}` },
      payload: { planCode },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ amountCents, status: 'pending', provider: 'manual' });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/organizations/${organization.id}/billing/orders/${created.json().id}/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe('paid');
    const summary = await app.inject({ method: 'GET', url: `/organizations/${organization.id}/billing`, headers: { authorization: `Bearer ${token}` } });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ subscription: { planCode, status: 'active' }, policy: { canManageBilling: true } });
    await sqlClient`delete from organizations where id = ${organization.id}`;
  });
});

describe('api security configuration', () => {
  const authService = new AuthService(db, new TestMailer(), { accessSecret: 'test-secret', emailVerificationRequired: false });
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.AUTH_ACCESS_SECRET;
  const originalCorsOrigins = process.env.CORS_ORIGINS;

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
    else process.env.AUTH_ACCESS_SECRET = originalSecret;
    if (originalCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = originalCorsOrigins;
  });

  it('only emits CORS headers for configured production origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ACCESS_SECRET = 'production-secret';
    process.env.CORS_ORIGINS = 'https://app.example.com, https://admin.example.com';
    const app = await buildApp({ authService });
    try {
      const allowed = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'GET' } });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

      const rejected = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' } });
      expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it.each([undefined, 'development-only-secret'])('rejects production startup with an unsafe AUTH_ACCESS_SECRET (%s)', async (secret) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    if (secret === undefined) delete process.env.AUTH_ACCESS_SECRET;
    else process.env.AUTH_ACCESS_SECRET = secret;
    await expect(buildApp({ authService })).rejects.toThrow(/AUTH_ACCESS_SECRET/);
  });

  it('rejects production startup without a CORS allowlist', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ACCESS_SECRET = 'production-secret';
    delete process.env.CORS_ORIGINS;
    await expect(buildApp({ authService })).rejects.toThrow(/CORS_ORIGINS/);
  });

  it('keeps the explicit development secret fallback outside production', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_ACCESS_SECRET;
    delete process.env.CORS_ORIGINS;
    const app = await buildApp({ authService });
    try {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('uses independent rate-limit buckets for login, registration codes, and password resets', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_ACCESS_SECRET;
    delete process.env.CORS_ORIGINS;
    const app = await buildApp({ authService, authRateLimitMax: 1 });
    try {
      const loginPayload = { email: 'not-an-email', password: 'incorrect password' };
      expect((await app.inject({ method: 'POST', url: '/auth/login', payload: loginPayload })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/auth/login', payload: loginPayload })).statusCode).toBe(429);

      const registrationPayload = { email: `code-${randomUUID()}@example.com` };
      expect((await app.inject({ method: 'POST', url: '/auth/register/request-code', payload: registrationPayload })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/auth/register/request-code', payload: registrationPayload })).statusCode).toBe(429);

      const registerPayload = { email: `register-${randomUUID()}@example.com`, password: 'short', displayName: 'Rate limited' };
      expect((await app.inject({ method: 'POST', url: '/auth/register', payload: registerPayload })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/auth/register', payload: registerPayload })).statusCode).toBe(429);

      const resetPayload = { email: 'not-an-email' };
      expect((await app.inject({ method: 'POST', url: '/auth/password/request', payload: resetPayload })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/auth/password/request', payload: resetPayload })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('reports unavailable mail delivery before issuing credentials', async () => {
    const unavailableAuth = new AuthService(db, new UnavailableMailer(), { accessSecret: 'unavailable-mail-test' });
    const unavailableApp = await buildApp({ authService: unavailableAuth });
    try {
      expect((await unavailableApp.inject({ method: 'GET', url: '/auth/config' })).json()).toMatchObject({ emailDeliveryConfigured: false });

      const registration = await unavailableApp.inject({ method: 'POST', url: '/auth/register/request-code', payload: { email: `unavailable-${randomUUID()}@example.com` } });
      expect(registration.statusCode).toBe(503);
      expect(registration.json().error.code).toBe('EMAIL_DELIVERY_NOT_CONFIGURED');

      const reset = await unavailableApp.inject({ method: 'POST', url: '/auth/password/request', payload: { email: `unavailable-${randomUUID()}@example.com` } });
      expect(reset.statusCode).toBe(503);
      expect(reset.json().error.code).toBe('EMAIL_DELIVERY_NOT_CONFIGURED');
    } finally {
      await unavailableApp.close();
    }
  });
});
