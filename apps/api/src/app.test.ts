import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { db, sqlClient } from './db/client.js';
import { migrate } from './db/migrate.js';
import { AuthService, type Mailer } from './modules/auth/service.js';

class TestMailer implements Mailer {
  async sendVerification(): Promise<void> {}
}

describe('api app', () => {
  const email = `api-${randomUUID()}@example.com`;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    await migrate();
    app = await buildApp({ authService: new AuthService(db, new TestMailer(), { accessSecret: 'test-secret' }) });
  });

  afterAll(async () => {
    await app.close();
    await sqlClient`delete from users where email = ${email}`;
  });

  it('returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('registers a user through HTTP', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct horse battery staple' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().email).toBe(email);
  });
});
