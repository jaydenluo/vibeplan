import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db/client.js';
import { AuthError, AuthService } from './modules/auth/service.js';
import { EmailDeliveryError, SmtpMailer } from './modules/mail/mailer.js';
import { AccessError, AccessService } from './modules/access/service.js';
import { BillingError, BillingService } from './modules/billing/service.js';
import { BillingEntitlementError } from './modules/billing/entitlements.js';
import { BillingProviderError } from './modules/billing/providers/types.js';
import { PlatformAdminError, PlatformAdminService } from './modules/admin/service.js';
import { ProjectEventHub } from './modules/work-items/events.js';
import { WorkItemAccessError, WorkItemConflictError, WorkItemService, WorkItemTransitionError } from './modules/work-items/service.js';
import { MutationStore } from './modules/work-items/mutations.js';
import { SyncResetError } from './modules/work-items/sync-feed.js';
import { serverVersion } from './runtime/version.js';

const credentialsCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = value.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return fallbackMs;
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unitMs;
}

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8), displayName: z.string().trim().min(1).max(120), verificationCode: z.string().length(6).optional() });
const registrationCodeRequestSchema = z.object({ email: z.string().email() });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const passwordResetRequestSchema = z.object({ email: z.string().email() });
const passwordResetSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });
const tokenSchema = z.object({ token: z.string().min(1) });
const deviceCodeSchema = z.object({ deviceCode: z.string().min(1) });
const userCodeSchema = z.object({ userCode: z.string().min(1) });
const inviteLinkSchema = z.object({ teamId: z.string().uuid().optional() });
const profileSchema = z.object({ displayName: z.string().trim().max(120).optional().or(z.literal('')) });
const invitationSchema = z.object({ email: z.string().email(), teamId: z.string().uuid().optional() });
const reviewSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
const organizationSchema = z.object({ name: z.string().trim().min(1).max(120) });
const teamSchema = organizationSchema;
const projectSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).default(''), repositoryUrl: z.string().url().optional().or(z.literal('')) });
const teamUpdateSchema = teamSchema;
const projectUpdateSchema = projectSchema.partial();
const teamMemberRoleSchema = z.object({ role: z.enum(['lead', 'member']) });
const workItemStatusSchema = z.enum(['backlog', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled']);
const workItemCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().default(''),
  type: z.enum(['feature', 'bug', 'improvement', 'refactor', 'documentation', 'research', 'chore']),
  status: workItemStatusSchema,
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
  acceptanceCriteria: z.array(z.string().trim().min(1)).default([]),
  assigneeId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().default(null),
  estimate: z.number().int().positive(),
  progress: z.number().int().min(0).max(100).default(0),
  planMarkdown: z.string().max(100000).nullable().optional(),
  dependsOn: z.array(z.string().uuid()).default([]),
});
const workItemUpdateSchema = workItemCreateSchema.partial().extend({
  version: z.number().int().positive(),
  changeReason: z.string().trim().max(4000).optional(),
  executionStage: z.enum(['analysis', 'implementation', 'testing', 'blocked', 'ready_for_review']).optional(),
  executionNote: z.string().trim().max(4000).optional(),
});
const workItemDeleteSchema = z.object({ version: z.number().int().positive() });
const evidenceSchema = z.object({ label: z.string().trim().min(1).max(240), url: z.string().url().max(2000).refine((url) => /^https?:\/\//i.test(url), 'Only HTTP/HTTPS evidence URLs are supported') });
const workItemReportSchema = z.object({
  version: z.number().int().positive(),
  summary: z.string().trim().min(1).max(20000),
  changedFiles: z.array(z.string().trim().min(1).max(2000)).max(500).default([]),
  tests: z.array(z.object({ command: z.string().trim().min(1).max(4000), result: z.string().trim().min(1).max(20000), outcome: z.enum(['passed', 'failed', 'skipped', 'not_run']).optional(), exitCode: z.number().int().optional() })).max(100).default([]),
  commit: z.string().trim().min(1).max(240).nullable().optional(),
  evidence: z.array(evidenceSchema).max(100).default([]),
  risks: z.array(z.string().trim().min(1).max(4000)).max(100).default([]),
  remainingIssues: z.array(z.string().trim().min(1).max(4000)).max(100).default([]),
  criterionResults: z.array(z.object({ acceptanceItemId: z.string().min(1).max(240), result: z.string().trim().min(1).max(4000), evidence: z.array(evidenceSchema).max(100).default([]) })).max(100).default([]),
  outcome: z.enum(['success', 'failed', 'blocked']).default('success'),
});
const workItemAcceptanceSchema = z.object({
  version: z.number().int().positive(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().optional(),
});
const acceptanceItemReviewSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(['unverified', 'passed', 'failed', 'needs_info']),
  comment: z.string().trim().max(4000).default(''),
  evidence: z.array(evidenceSchema).max(100).default([]),
});
const workLogSchema = z.object({ hours: z.number().positive().max(999999), content: z.string().trim().max(4000).default(''), workDate: z.string().date() });
const workLogCorrectionSchema = workLogSchema.partial().extend({ version: z.number().int().positive(), reason: z.string().trim().min(1).max(4000) });
const dependencySchema = z.object({ dependsOn: z.array(z.string().uuid()) });
const milestoneSchema = z.object({ name: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).default(''), targetDate: z.string().date().nullable().default(null) });
const milestoneAssignmentSchema = z.object({ milestoneId: z.string().uuid() });
const billingOrderSchema = z.object({ planCode: z.enum(['free', 'personal', 'team_10', 'team_30', 'team_100', 'enterprise_1000', 'custom']) });
const adminPageQuerySchema = z.object({ q: z.string().trim().max(160).optional(), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
const adminOrganizationQuerySchema = adminPageQuerySchema.extend({ planCode: z.string().max(32).optional(), state: z.enum(['free', 'active', 'grace', 'read_only']).optional() });
const adminOrderQuerySchema = adminPageQuerySchema.extend({ status: z.string().max(32).optional(), planCode: z.string().max(32).optional(), from: z.string().date().optional(), to: z.string().date().optional() });
const adminGrantSchema = z.object({ email: z.string().email(), role: z.enum(['super_admin', 'operator']) });

export type BuildAppOptions = {
  authService?: AuthService;
  accessService?: AccessService;
  workItemService?: WorkItemService;
  billingService?: BillingService;
  platformAdminService?: PlatformAdminService;
  eventHub?: ProjectEventHub;
  emailVerificationRequired?: boolean;
  rateLimitMax?: number;
  authRateLimitMax?: number;
};

function configuredCorsOrigins(): string[] {
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must be configured in production.');
  }
  return origins.length > 0 ? origins : ['http://localhost:5173'];
}

function configuredAccessSecret(): string {
  const secret = process.env.AUTH_ACCESS_SECRET?.trim();
  if (process.env.NODE_ENV === 'production' && (!secret || secret === 'development-only-secret')) {
    throw new Error('AUTH_ACCESS_SECRET must be configured with a non-default value in production.');
  }
  return secret || 'development-only-secret';
}

function configuredTrustProxy(): boolean | string[] {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value) return false;
  if (value === 'true') return true;
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function requestToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return request.cookies.vibe_access;
}

/**
 * Validates and returns a UUID path parameter.
 * Throws a 400 error if the parameter is not a valid UUID.
 */
function validateUuidParam(value: string, paramName: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw { statusCode: 400, message: `Invalid ${paramName}: must be a valid UUID` };
  }
  return value;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const corsOrigins = configuredCorsOrigins();
  const accessSecret = configuredAccessSecret();
  const app = Fastify({ logger: false, trustProxy: configuredTrustProxy() });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, callback) => callback(null, origin ? corsOrigins.includes(origin) : false),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => `${request.ip}:${request.routeOptions.url ?? request.url.split('?')[0]}`,
  });

  const auth = options.authService ?? new AuthService(
    db,
    new SmtpMailer(),
    {
      accessSecret,
      accessTokenTtl: process.env.AUTH_ACCESS_TOKEN_TTL ?? '30m',
      refreshTokenTtlMs: parseDurationMs(process.env.AUTH_REFRESH_TOKEN_TTL, 90 * 24 * 60 * 60 * 1000),
      emailVerificationRequired: options.emailVerificationRequired ?? process.env.EMAIL_VERIFICATION_REQUIRED !== 'false',
    },
  );
  const access = options.accessService ?? new AccessService(db);
  const billing = options.billingService ?? new BillingService(db);
  const platformAdmin = options.platformAdminService ?? new PlatformAdminService(db);
  const eventHub = options.eventHub ?? new ProjectEventHub();
  const workItems = options.workItemService ?? new WorkItemService(db, eventHub);
  const mutations = new MutationStore(db, eventHub);
  const mutate = async <T>(request: FastifyRequest, userId: string, target: { projectId?: string; taskId?: string; reviewer?: boolean }, body: unknown, operation: (service: WorkItemService, actorId: string) => Promise<T>) => {
    const id = request.headers['x-mutation-id'] ?? request.headers['idempotency-key'];
    if (!id) return operation(workItems, userId);
    const mutationId = z.string().uuid().parse(id);
    return mutations.execute(userId, mutationId, { method: request.method, url: request.url, body }, target, (service) => operation(service, userId));
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SyncResetError) return reply.code(409).send({ error: { code: 'SYNC_RESET_REQUIRED', message: error.message } });
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') } });
    }
    if (error instanceof EmailDeliveryError) {
      return reply.code(503).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AuthError) {
      const status = ['INVALID_CREDENTIALS', 'INVALID_ACCESS_TOKEN', 'INVALID_REFRESH_TOKEN'].includes(error.code) ? 401 : 400;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return reply.code(error.code === 'NOT_FOUND' ? 404 : 403).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof BillingEntitlementError || error instanceof BillingError || error instanceof BillingProviderError) {
      const statusCode = error instanceof BillingEntitlementError ? error.statusCode : error instanceof BillingError ? error.statusCode : 400;
      return reply.code(statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof PlatformAdminError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof WorkItemConflictError) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: error.message } });
    }
    if (error instanceof WorkItemTransitionError) {
      return reply.code(400).send({ error: { code: 'INVALID_TRANSITION', message: error.message } });
    }
    if (error instanceof WorkItemAccessError) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: error.message } });
    }
    const httpError = error as { statusCode?: number; code?: string; message?: string };
    if (httpError.statusCode && httpError.statusCode >= 400 && httpError.statusCode < 500) return reply.code(httpError.statusCode).send({ error: { code: httpError.code ?? 'REQUEST_ERROR', message: httpError.message } });
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/version', async () => serverVersion());

  app.get('/auth/config', async () => ({ emailVerificationRequired: auth.requiresEmailVerification(), emailDeliveryConfigured: auth.isEmailDeliveryConfigured() }));

  const authRateLimit = { max: options.authRateLimitMax ?? 10, timeWindow: '1 minute' };

  app.post('/auth/register/request-code', { config: { rateLimit: authRateLimit } }, async (request) => {
    if (!auth.requiresEmailVerification()) return { expiresInSeconds: 0 };
    const body = registrationCodeRequestSchema.parse(request.body);
    return auth.requestRegistrationCode(body.email);
  });

  app.post('/auth/register', { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = await auth.register(body.email, body.password, body.displayName, body.verificationCode);
    return reply.code(201).send(user);
  });

  app.post('/auth/verify-email', async (request) => {
    const body = tokenSchema.parse(request.body);
    await auth.verifyEmail(body.token);
    return { status: 'verified' };
  });

  app.post('/auth/login', { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const session = await auth.login(body.email, body.password);
    reply.setCookie('vibe_access', session.accessToken, { ...credentialsCookie, maxAge: session.expiresInSeconds });
    reply.setCookie('vibe_refresh', session.refreshToken, { ...credentialsCookie, maxAge: session.refreshExpiresInSeconds });
    return { expiresInSeconds: session.expiresInSeconds };
  });

  app.post('/auth/password/request', { config: { rateLimit: authRateLimit } }, async (request) => {
    await auth.requestPasswordReset(passwordResetRequestSchema.parse(request.body).email);
    return { status: 'sent' };
  });

  app.post('/auth/password/reset', { config: { rateLimit: authRateLimit } }, async (request) => {
    const body = passwordResetSchema.parse(request.body);
    await auth.resetPassword(body.token, body.password);
    return { status: 'reset' };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies.vibe_refresh;
    if (token) {
      try { await auth.revokeRefreshToken(token); } catch { /* Logout remains successful if the token is already expired. */ }
    }
    reply.clearCookie('vibe_access', credentialsCookie);
    reply.clearCookie('vibe_refresh', credentialsCookie);
    return { status: 'signed_out' };
  });

  app.post('/auth/refresh', { config: { rateLimit: authRateLimit } }, async (request, reply) => {
    const bodyToken = (request.body as { refreshToken?: string } | undefined)?.refreshToken;
    const refreshToken = request.cookies.vibe_refresh ?? bodyToken;
    if (!refreshToken) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is required.');
    }
    const session = await auth.refresh(refreshToken);
    reply.setCookie('vibe_access', session.accessToken, { ...credentialsCookie, maxAge: session.expiresInSeconds });
    reply.setCookie('vibe_refresh', session.refreshToken, { ...credentialsCookie, maxAge: session.refreshExpiresInSeconds });
    // Browsers use HttpOnly cookies; native clients must receive both rotated tokens.
    return bodyToken && !request.cookies.vibe_refresh ? session : { expiresInSeconds: session.expiresInSeconds };
  });

  app.post('/auth/device/start', { config: { rateLimit: authRateLimit } }, async () => auth.startDeviceAuthorization());

  app.post('/auth/device/approve', { config: { rateLimit: authRateLimit } }, async (request) => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    const userId = await auth.verifyAccessToken(token);
    const body = userCodeSchema.parse(request.body);
    await auth.approveDevice(body.userCode, userId);
    return { status: 'approved' };
  });

  app.post('/auth/device/exchange', { config: { rateLimit: authRateLimit } }, async (request) => {
    const body = deviceCodeSchema.parse(request.body);
    return auth.exchangeDevice(body.deviceCode);
  });

  app.get('/auth/me', async (request) => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    return auth.getUser(await auth.verifyAccessToken(token));
  });

  app.patch('/auth/me', async (request) => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    const body = profileSchema.parse(request.body);
    return auth.updateProfile(await auth.verifyAccessToken(token), body.displayName || null);
  });

  const authenticatedUserId = async (request: FastifyRequest): Promise<string> => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    return auth.verifyAccessToken(token);
  };

  app.get('/admin/me', async (request) => platformAdmin.getMe(await authenticatedUserId(request)));
  app.get('/admin/overview', async (request) => platformAdmin.overview(await authenticatedUserId(request)));
  app.get('/admin/users', async (request) => platformAdmin.listUsers(await authenticatedUserId(request), adminPageQuerySchema.parse(request.query)));
  app.get('/admin/organizations', async (request) => platformAdmin.listOrganizations(await authenticatedUserId(request), adminOrganizationQuerySchema.parse(request.query)));
  app.get('/admin/orders', async (request) => platformAdmin.listOrders(await authenticatedUserId(request), adminOrderQuerySchema.parse(request.query)));
  app.get('/admin/admins', async (request) => platformAdmin.listAdmins(await authenticatedUserId(request)));
  app.post('/admin/admins', async (request, reply) => {
    const body = adminGrantSchema.parse(request.body);
    return reply.code(201).send(await platformAdmin.grant(await authenticatedUserId(request), body.email, body.role));
  });
  app.delete('/admin/admins/:userId', async (request) => {
    const params = request.params as { userId: string };
    z.string().uuid().parse(params.userId);
    return platformAdmin.revoke(await authenticatedUserId(request), params.userId);
  });

  app.get('/organizations', async (request) => access.listOrganizations(await authenticatedUserId(request)));

  app.post('/organizations', async (request, reply) => {
    const body = organizationSchema.parse(request.body);
    const organization = await access.createOrganization(await authenticatedUserId(request), body.name);
    return reply.code(201).send(organization);
  });

  app.get('/organizations/:organizationId/teams', async (request) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    return access.listTeams(await authenticatedUserId(request), params.organizationId);
  });

  app.get('/organizations/:organizationId/members', async (request) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    return access.listOrganizationMembers(await authenticatedUserId(request), params.organizationId);
  });

  app.get('/organizations/:organizationId/billing', async (request) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    return billing.getSummary(await authenticatedUserId(request), params.organizationId);
  });

  app.post('/organizations/:organizationId/billing/orders', async (request, reply) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    const body = billingOrderSchema.parse(request.body);
    return reply.code(201).send(await billing.createOrder(await authenticatedUserId(request), params.organizationId, body.planCode));
  });

  app.get('/organizations/:organizationId/billing/orders/:orderId', async (request) => {
    const params = request.params as { organizationId: string; orderId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    validateUuidParam(params.orderId, 'orderId');
    return billing.getOrder(await authenticatedUserId(request), params.organizationId, params.orderId);
  });

  app.post('/organizations/:organizationId/billing/orders/:orderId/confirm', async (request) => {
    const params = request.params as { organizationId: string; orderId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    validateUuidParam(params.orderId, 'orderId');
    return billing.confirmManualOrder(await authenticatedUserId(request), params.organizationId, params.orderId);
  });

  app.post('/organizations/:organizationId/billing/orders/:orderId/pay', async (request) => {
    const params = request.params as { organizationId: string; orderId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    validateUuidParam(params.orderId, 'orderId');
    return billing.resumePayment(await authenticatedUserId(request), params.organizationId, params.orderId);
  });

  // Payment webhook with dedicated rate limiting
  app.post('/billing/alipay/notify', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    try {
      const payload = z.record(z.string()).parse(request.body);
      await billing.confirmAlipayNotification(payload);
      return reply.type('text/plain').send('success');
    } catch (error) {
      request.log.warn(error);
      return reply.code(400).type('text/plain').send('failure');
    }
  });

  app.post('/organizations/:organizationId/teams', async (request, reply) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    const body = teamSchema.parse(request.body);
    const team = await access.createTeam(await authenticatedUserId(request), params.organizationId, body.name);
    return reply.code(201).send(team);
  });

  app.patch('/teams/:teamId', async (request) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    const body = teamUpdateSchema.parse(request.body);
    return access.updateTeam(await authenticatedUserId(request), params.teamId, body.name!);
  });

  app.post('/organizations/:organizationId/invitations', async (request, reply) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    const body = invitationSchema.parse(request.body);
    const invitation = await access.inviteMember(await authenticatedUserId(request), params.organizationId, body.email, body.teamId);
    return reply.code(201).send(invitation);
  });

  app.post('/organizations/:organizationId/invite-links', async (request) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    const body = inviteLinkSchema.parse(request.body ?? {});
    return access.createInviteLink(await authenticatedUserId(request), params.organizationId, body.teamId);
  });

  app.get('/invite-links/:token', async (request) => {
    const params = request.params as { token: string };
    return access.getInviteLink(params.token);
  });

  app.post('/invite-links/:token/accept', async (request) => {
    const params = request.params as { token: string };
    return access.acceptInviteLink(await authenticatedUserId(request), params.token);
  });

  app.delete('/invite-links/:token', async (request) => {
    const params = request.params as { token: string };
    return access.revokeInviteLink(await authenticatedUserId(request), params.token);
  });

  app.get('/me/pending', async (request) => access.listPending(await authenticatedUserId(request)));

  app.post('/invitations/:invitationId/accept', async (request) => {
    const params = request.params as { invitationId: string };
    validateUuidParam(params.invitationId, 'invitationId');
    return access.acceptInvitation(await authenticatedUserId(request), params.invitationId);
  });

  app.post('/invitations/:invitationId/reject', async (request) => {
    const params = request.params as { invitationId: string };
    validateUuidParam(params.invitationId, 'invitationId');
    return access.rejectInvitation(await authenticatedUserId(request), params.invitationId);
  });

  app.get('/organizations/:organizationId/projects', async (request) => {
    const params = request.params as { organizationId: string };
    validateUuidParam(params.organizationId, 'organizationId');
    return access.listProjects(params.organizationId, await authenticatedUserId(request));
  });

  app.get('/projects/:projectId', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    return access.getProject(await authenticatedUserId(request), params.projectId);
  });

  app.post('/teams/:teamId/projects', async (request, reply) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    const body = projectSchema.parse(request.body);
    const project = await access.createProject(await authenticatedUserId(request), params.teamId, body.name, body.repositoryUrl || undefined, body.description);
    return reply.code(201).send(project);
  });

  app.patch('/projects/:projectId', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    const body = projectUpdateSchema.parse(request.body);
    return access.updateProject(await authenticatedUserId(request), params.projectId, { name: body.name, description: body.description, repositoryUrl: body.repositoryUrl });
  });

  app.get('/teams/:teamId/members', async (request) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    return access.listTeamMembers(await authenticatedUserId(request), params.teamId);
  });

  app.get('/teams/:teamId/details', async (request) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    return access.getTeamDetails(await authenticatedUserId(request), params.teamId);
  });

  app.patch('/teams/:teamId/members/:memberId', async (request) => {
    const params = request.params as { teamId: string; memberId: string };
    validateUuidParam(params.teamId, 'teamId');
    validateUuidParam(params.memberId, 'memberId');
    const body = teamMemberRoleSchema.parse(request.body);
    return access.updateTeamMember(await authenticatedUserId(request), params.teamId, params.memberId, body.role);
  });

  app.delete('/teams/:teamId/members/:memberId', async (request) => {
    const params = request.params as { teamId: string; memberId: string };
    validateUuidParam(params.teamId, 'teamId');
    validateUuidParam(params.memberId, 'memberId');
    return access.removeTeamMember(await authenticatedUserId(request), params.teamId, params.memberId);
  });

  app.post('/teams/:teamId/join-requests', async (request, reply) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    const joinRequest = await access.requestTeamMembership(await authenticatedUserId(request), params.teamId);
    return reply.code(201).send(joinRequest);
  });

  app.get('/teams/:teamId/join-requests', async (request) => {
    const params = request.params as { teamId: string };
    validateUuidParam(params.teamId, 'teamId');
    return access.listTeamJoinRequests(await authenticatedUserId(request), params.teamId);
  });

  app.post('/team-join-requests/:requestId/review', async (request) => {
    const params = request.params as { requestId: string };
    validateUuidParam(params.requestId, 'requestId');
    const body = reviewSchema.parse(request.body);
    return access.reviewTeamJoinRequest(await authenticatedUserId(request), params.requestId, body.decision);
  });

  app.get('/projects/:projectId/work-items', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    const query = request.query as { status?: string; priority?: string; assigneeId?: string };
    return workItems.list(await authenticatedUserId(request), params.projectId, {
      status: query.status as never,
      priority: query.priority as never,
      assigneeId: query.assigneeId,
    });
  });

  app.post('/projects/:projectId/work-items', async (request, reply) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    const body = workItemCreateSchema.parse(request.body);
    const item = await mutate(request, await authenticatedUserId(request), { projectId: params.projectId }, body, (service, userId) => service.create(userId, params.projectId, body));
    return reply.code(201).send(item);
  });

  app.get('/work-items/:workItemId', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.get(await authenticatedUserId(request), params.workItemId);
  });

  app.patch('/work-items/:workItemId', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = workItemUpdateSchema.parse(request.body);
    const { version, ...patch } = body;
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.update(userId, params.workItemId, version, patch));
  });

  app.get('/work-items/:workItemId/permissions', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.permissions(await authenticatedUserId(request), params.workItemId);
  });

  app.patch('/work-items/:workItemId/acceptance-items/:acceptanceItemId', async (request) => {
    const params = request.params as { workItemId: string; acceptanceItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    // acceptanceItemId is not a UUID - it's a client-generated identifier
    const body = acceptanceItemReviewSchema.parse(request.body);
    const { version, ...review } = body;
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId, reviewer: true }, body, (service, userId) => service.updateAcceptanceItem(userId, params.workItemId, version, params.acceptanceItemId, review));
  });

  app.get('/work-items/:workItemId/work-logs', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.workLogs(await authenticatedUserId(request), params.workItemId);
  });

  app.post('/work-items/:workItemId/work-logs', async (request, reply) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = workLogSchema.parse(request.body);
    return reply.code(201).send(await mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.addWorkLog(userId, params.workItemId, body)));
  });

  app.patch('/work-items/:workItemId/work-logs/:logId', async (request) => {
    const params = request.params as { workItemId: string; logId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    validateUuidParam(params.logId, 'logId');
    const body = workLogCorrectionSchema.parse(request.body);
    const { version, ...patch } = body;
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.correctWorkLog(userId, params.workItemId, params.logId, version, patch));
  });

  app.delete('/work-items/:workItemId/work-logs/:logId', async (request) => {
    const params = request.params as { workItemId: string; logId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    validateUuidParam(params.logId, 'logId');
    const body = workLogCorrectionSchema.pick({ version: true, reason: true }).parse(request.body);
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.correctWorkLog(userId, params.workItemId, params.logId, body.version, { reason: body.reason, revoked: true }));
  });

  app.get('/organizations/:organizationId/my-work', async (request) => {
    const { organizationId } = request.params as { organizationId: string };
    validateUuidParam(organizationId, 'organizationId');
    return workItems.myWork(await authenticatedUserId(request), organizationId);
  });

  app.get('/organizations/:organizationId/overview', async (request) => {
    const { organizationId } = request.params as { organizationId: string };
    validateUuidParam(organizationId, 'organizationId');
    return workItems.organizationOverview(await authenticatedUserId(request), organizationId);
  });

  app.get('/projects/:projectId/contributors', async (request) => {
    const { projectId } = request.params as { projectId: string };
    validateUuidParam(projectId, 'projectId');
    const range = z.object({ from: z.string().date().optional(), to: z.string().date().optional() }).refine((range) => !range.from || !range.to || range.from <= range.to, 'Invalid time range').parse(request.query);
    return workItems.contributors(await authenticatedUserId(request), projectId, range);
  });

  app.get('/projects/:projectId/sync', async (request) => {
    const { projectId } = request.params as { projectId: string };
    validateUuidParam(projectId, 'projectId');
    const query = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }).parse(request.query);
    return workItems.syncFeed(await authenticatedUserId(request), projectId, query.cursor, query.limit);
  });

  app.get('/work-items/:workItemId/dependencies', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.listDependencies(await authenticatedUserId(request), params.workItemId);
  });

  app.put('/work-items/:workItemId/dependencies', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = dependencySchema.parse(request.body);
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.setDependencies(userId, params.workItemId, body.dependsOn));
  });

  app.post('/work-items/:workItemId/milestone', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.assignMilestone(await authenticatedUserId(request), params.workItemId, milestoneAssignmentSchema.parse(request.body).milestoneId);
  });

  app.get('/projects/:projectId/milestones', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    return workItems.listMilestones(await authenticatedUserId(request), params.projectId);
  });

  app.post('/projects/:projectId/milestones', async (request, reply) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    const [milestone] = await workItems.createMilestone(await authenticatedUserId(request), params.projectId, milestoneSchema.parse(request.body));
    return reply.code(201).send(milestone);
  });

  app.get('/projects/:projectId/health', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    return workItems.health(await authenticatedUserId(request), params.projectId);
  });

  app.delete('/work-items/:workItemId', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = workItemDeleteSchema.parse(request.body);
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.remove(userId, params.workItemId, body.version));
  });

  app.get('/work-items/:workItemId/events', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    return workItems.history(await authenticatedUserId(request), params.workItemId);
  });

  app.post('/work-items/:workItemId/report', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = workItemReportSchema.parse(request.body);
    const { version, ...report } = body;
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId }, body, (service, userId) => service.report(userId, params.workItemId, version, report));
  });

  app.post('/work-items/:workItemId/accept', async (request) => {
    const params = request.params as { workItemId: string };
    validateUuidParam(params.workItemId, 'workItemId');
    const body = workItemAcceptanceSchema.parse(request.body);
    const { version, ...acceptance } = body;
    return mutate(request, await authenticatedUserId(request), { taskId: params.workItemId, reviewer: true }, body, (service, userId) => service.accept(userId, params.workItemId, version, acceptance));
  });

  app.get('/projects/:projectId/events', async (request) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    await workItems.assertViewer(await authenticatedUserId(request), params.projectId);
    return workItems.events(params.projectId);
  });

  app.get('/projects/:projectId/events/stream', async (request, reply) => {
    const params = request.params as { projectId: string };
    validateUuidParam(params.projectId, 'projectId');
    await workItems.assertViewer(await authenticatedUserId(request), params.projectId);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write('event: ready\ndata: {}\n\n');
    const unsubscribe = eventHub.subscribe(params.projectId, (event) => {
      reply.raw.write(`event: work-item\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}
