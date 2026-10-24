// No .env is read. Use an isolated, explicitly named local test database only.
process.env.DATABASE_URL = 'postgres://vibe:vibe@localhost:5433/vibe_plan_test';
process.env.API_PORT = '4401';
process.env.NODE_ENV = 'test';
process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
process.env.AUTH_ACCESS_SECRET = 'isolated-e2e-secret-never-use-in-production';
process.env.AUTH_ACCESS_TOKEN_TTL = '2s';
process.env.AUTH_REFRESH_TOKEN_TTL = '1h';
process.env.APP_VERSION = 'e2e';
process.env.BUILD_COMMIT = 'local-test';
const { migrate } = await import('../../apps/api/src/db/migrate.js');
await migrate();
const { buildApp } = await import('../../apps/api/src/app.js');
// A complete multi-browser fixture exceeds the normal per-IP request budget.
const app = await buildApp({ rateLimitMax: 1000 });
app.addHook('onError', async (_request, _reply, error) => {
  if (!['AuthError', 'WorkItemConflictError', 'WorkItemTransitionError', 'WorkItemAccessError'].includes(error.name)) {
    console.error(`Unexpected E2E API error: ${error.name}: ${error.message}`);
  }
});
await app.listen({ host: 'localhost', port: 4401 });
// Exercise the packed client's public /api base through a local reverse proxy.
const { createServer, request } = await import('node:http');
createServer((incoming, outgoing) => {
  if (!incoming.url?.startsWith('/api/')) { outgoing.writeHead(404); outgoing.end(); return; }
  const forwarded = request({ hostname: 'localhost', port: 4401, path: incoming.url.slice(4), method: incoming.method, headers: incoming.headers }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  forwarded.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
  incoming.pipe(forwarded);
}).listen(4403, 'localhost');
