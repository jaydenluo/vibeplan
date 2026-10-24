import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect, request } from '@playwright/test';

const apiURL = 'http://localhost:4401';
type Session = { accessToken: string; refreshToken: string };
test('two native sessions refresh concurrently and each rotates twice after short access expiration', async () => {
  const api = await request.newContext({ baseURL: apiURL });
  const email = `e2e-native-${randomUUID()}@example.com`;
  const password = 'E2E-only-native-password';
  let userId: string | undefined;
  try {
    const registered = await api.post('/auth/register', { data: { email, password, displayName: 'E2E native session' } });
    expect(registered.status()).toBe(201);
    userId = (await registered.json()).id;
    expect((await api.post('/auth/login', { data: { email, password } })).ok()).toBe(true);
    const sessions: Session[] = [];
    for (let terminal = 0; terminal < 2; terminal++) {
      const device = await (await api.post('/auth/device/start')).json();
      expect((await api.post('/auth/device/approve', { data: { userCode: device.userCode } })).ok()).toBe(true);
      const exchange = await api.post('/auth/device/exchange', { data: { deviceCode: device.deviceCode } });
      expect(exchange.ok()).toBe(true);
      sessions.push(await exchange.json());
    }
    const me = (token: string) => fetch(`${apiURL}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    // JWTs expire in two seconds in this dedicated server; do not wait production TTLs.
    await expect.poll(async () => (await me(sessions[0].accessToken)).status, { timeout: 5000 }).toBe(401);
    for (let rotation = 0; rotation < 2; rotation++) {
      const previous = sessions.map((session) => session.refreshToken);
      const responses = await Promise.all(sessions.map((session) => fetch(`${apiURL}/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }),
      })));
      for (const [index, response] of responses.entries()) {
        expect(response.status).toBe(200);
        sessions[index] = await response.json() as Session;
        expect(sessions[index].refreshToken).toBeTruthy();
        expect(sessions[index].refreshToken).not.toBe(previous[index]);
        expect((await me(sessions[index].accessToken)).status).toBe(200);
        const reused = await fetch(`${apiURL}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: previous[index] }) });
        expect(reused.status).toBe(401);
      }
    }
  } finally {
    await api.dispose();
    if (userId) {
      const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
      const sql = require('postgres')('postgres://vibe:vibe@localhost:5433/vibe_plan_test', { onnotice: () => undefined });
      try { await sql`delete from users where id=${userId}`; } finally { await sql.end(); }
    }
  }
});
