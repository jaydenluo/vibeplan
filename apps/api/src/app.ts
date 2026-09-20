import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db/client.js';
import { AuthError, AuthService } from './modules/auth/service.js';
import { ConsoleMailer } from './modules/mail/mailer.js';
import { AccessError, AccessService } from './modules/access/service.js';

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

export type BuildAppOptions = {
  authService?: AuthService;
  accessService?: AccessService;
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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthError) {
      const status = error.code === 'INVALID_CREDENTIALS' || error.code === 'INVALID_ACCESS_TOKEN' ? 401 : 400;
      return reply.code(status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return reply.code(error.code === 'NOT_FOUND' ? 404 : 403).send({ error: { code: error.code, message: error.message } });
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

  app.post('/teams/:teamId/projects', async (request, reply) => {
    const params = request.params as { teamId: string };
    const body = projectSchema.parse(request.body);
    const project = await access.createProject(await authenticatedUserId(request), params.teamId, body.name, body.slug, body.repositoryUrl);
    return reply.code(201).send(project);
  });

  return app;
}
