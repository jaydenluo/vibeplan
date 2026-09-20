import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db/client.js';
import { AuthError, AuthService } from './modules/auth/service.js';
import { ConsoleMailer } from './modules/mail/mailer.js';
import { AccessError, AccessService } from './modules/access/service.js';
import { ProjectEventHub } from './modules/work-items/events.js';
import { WorkItemAccessError, WorkItemConflictError, WorkItemService, WorkItemTransitionError } from './modules/work-items/service.js';

const credentialsCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const loginSchema = registerSchema;
const tokenSchema = z.object({ token: z.string().min(1) });
const deviceCodeSchema = z.object({ deviceCode: z.string().min(1) });
const userCodeSchema = z.object({ userCode: z.string().min(1) });
const organizationSchema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().regex(/^[a-z0-9-]+$/) });
const teamSchema = organizationSchema;
const projectSchema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().regex(/^[a-z0-9-]+$/), repositoryUrl: z.string().url() });
const workItemCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().optional(),
  type: z.enum(['feature', 'bug', 'improvement', 'refactor', 'documentation', 'research', 'chore']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']),
  acceptanceCriteria: z.array(z.string().min(1)).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
});
const workItemUpdateSchema = workItemCreateSchema.partial().extend({
  status: z.enum(['backlog', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled']).optional(),
  version: z.number().int().positive(),
  acceptanceRecorded: z.boolean().optional(),
});

export type BuildAppOptions = {
  authService?: AuthService;
  accessService?: AccessService;
  workItemService?: WorkItemService;
  eventHub?: ProjectEventHub;
};

function requestToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return request.cookies.vibe_access;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  const auth = options.authService ?? new AuthService(
    db,
    new ConsoleMailer(),
    { accessSecret: process.env.AUTH_ACCESS_SECRET ?? 'development-only-secret' },
  );
  const access = options.accessService ?? new AccessService(db);
  const eventHub = options.eventHub ?? new ProjectEventHub();
  const workItems = options.workItemService ?? new WorkItemService(db, eventHub);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthError) {
      const status = error.code === 'INVALID_CREDENTIALS' || error.code === 'INVALID_ACCESS_TOKEN' ? 401 : 400;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return reply.code(error.code === 'NOT_FOUND' ? 404 : 403).send({ error: { code: error.code, message: error.message } });
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
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = await auth.register(body.email, body.password);
    return reply.code(201).send(user);
  });

  app.post('/auth/verify-email', async (request) => {
    const body = tokenSchema.parse(request.body);
    await auth.verifyEmail(body.token);
    return { status: 'verified' };
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const session = await auth.login(body.email, body.password);
    reply.setCookie('vibe_access', session.accessToken, { ...credentialsCookie, maxAge: session.expiresInSeconds });
    reply.setCookie('vibe_refresh', session.refreshToken, { ...credentialsCookie, maxAge: 30 * 24 * 60 * 60 });
    return { expiresInSeconds: session.expiresInSeconds };
  });

  app.post('/auth/refresh', async (request, reply) => {
    const refreshToken = request.cookies.vibe_refresh ?? (request.body as { refreshToken?: string } | undefined)?.refreshToken;
    if (!refreshToken) {
      throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token is required.');
    }
    const session = await auth.refresh(refreshToken);
    reply.setCookie('vibe_access', session.accessToken, { ...credentialsCookie, maxAge: session.expiresInSeconds });
    reply.setCookie('vibe_refresh', session.refreshToken, { ...credentialsCookie, maxAge: 30 * 24 * 60 * 60 });
    return { expiresInSeconds: session.expiresInSeconds };
  });

  app.post('/auth/device/start', async () => auth.startDeviceAuthorization());

  app.post('/auth/device/approve', async (request) => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    const userId = await auth.verifyAccessToken(token);
    const body = userCodeSchema.parse(request.body);
    await auth.approveDevice(body.userCode, userId);
    return { status: 'approved' };
  });

  app.post('/auth/device/exchange', async (request) => {
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

  const authenticatedUserId = async (request: FastifyRequest): Promise<string> => {
    const token = requestToken(request);
    if (!token) {
      throw new AuthError('INVALID_ACCESS_TOKEN', 'Access token is required.');
    }
    return auth.verifyAccessToken(token);
  };

  app.get('/organizations', async (request) => access.listOrganizations(await authenticatedUserId(request)));

  app.post('/organizations', async (request, reply) => {
    const body = organizationSchema.parse(request.body);
    const organization = await access.createOrganization(await authenticatedUserId(request), body.name, body.slug);
    return reply.code(201).send(organization);
  });

  app.get('/organizations/:organizationId/teams', async (request) => {
    const params = request.params as { organizationId: string };
    return access.listTeams(await authenticatedUserId(request), params.organizationId);
  });

  app.post('/organizations/:organizationId/teams', async (request, reply) => {
    const params = request.params as { organizationId: string };
    const body = teamSchema.parse(request.body);
    const team = await access.createTeam(await authenticatedUserId(request), params.organizationId, body.name, body.slug);
    return reply.code(201).send(team);
  });

  app.get('/organizations/:organizationId/projects', async (request) => {
    const params = request.params as { organizationId: string };
    return access.listProjects(params.organizationId, await authenticatedUserId(request));
  });

  app.get('/projects/:projectId', async (request) => {
    const params = request.params as { projectId: string };
    return access.getProject(await authenticatedUserId(request), params.projectId);
  });

  app.post('/teams/:teamId/projects', async (request, reply) => {
    const params = request.params as { teamId: string };
    const body = projectSchema.parse(request.body);
    const project = await access.createProject(await authenticatedUserId(request), params.teamId, body.name, body.slug, body.repositoryUrl);
    return reply.code(201).send(project);
  });

  app.get('/projects/:projectId/work-items', async (request) => {
    const params = request.params as { projectId: string };
    const query = request.query as { status?: string; priority?: string; assigneeId?: string };
    return workItems.list(await authenticatedUserId(request), params.projectId, {
      status: query.status as never,
      priority: query.priority as never,
      assigneeId: query.assigneeId,
    });
  });

  app.post('/projects/:projectId/work-items', async (request, reply) => {
    const params = request.params as { projectId: string };
    const body = workItemCreateSchema.parse(request.body);
    const item = await workItems.create(await authenticatedUserId(request), params.projectId, body);
    return reply.code(201).send(item);
  });

  app.get('/work-items/:workItemId', async (request) => {
    const params = request.params as { workItemId: string };
    return workItems.get(await authenticatedUserId(request), params.workItemId);
  });

  app.patch('/work-items/:workItemId', async (request) => {
    const params = request.params as { workItemId: string };
    const body = workItemUpdateSchema.parse(request.body);
    const { version, ...patch } = body;
    return workItems.update(await authenticatedUserId(request), params.workItemId, version, patch);
  });

  app.get('/projects/:projectId/events', async (request, reply) => {
    const params = request.params as { projectId: string };
    await workItems.assertViewer(await authenticatedUserId(request), params.projectId);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write('event: ready\ndata: {}\n\n');
    const unsubscribe = eventHub.subscribe(params.projectId, (event) => {
      reply.raw.write(`event: work-item\\ndata: ${JSON.stringify(event)}\\n\\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\\n\\n'), 15000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}
