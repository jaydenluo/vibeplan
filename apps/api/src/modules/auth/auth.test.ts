import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../db/migrate.js';
import { db, sqlClient } from '../../db/client.js';
import { AuthService, AuthError, type Mailer } from './service.js';

class TestMailer implements Mailer {
  verificationTokens: string[] = [];

  async sendVerification(_email: string, token: string): Promise<void> {
    this.verificationTokens.push(token);
  }
}

describe('email authentication', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('requires verified email before login and rotates refresh tokens', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });

    const registered = await auth.register(' Alice@Example.com ', 'correct horse battery staple');
    await expect(auth.login('alice@example.com', 'correct horse battery staple')).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });

    await auth.verifyEmail(mailer.verificationTokens[0]);
    const firstSession = await auth.login('ALICE@example.com', 'correct horse battery staple');
    const secondSession = await auth.refresh(firstSession.refreshToken);

    expect(registered.email).toBe('alice@example.com');
    expect(secondSession.refreshToken).not.toBe(firstSession.refreshToken);
    await expect(auth.refresh(firstSession.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('rejects duplicate normalized emails', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });

    const registered = await auth.register(`duplicate-${randomUUID()}@example.com`, 'a secure password');
    await expect(auth.register(` ${registered.email.toUpperCase()} `, 'another secure password')).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('exchanges an approved device code for a session', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });
    const registered = await auth.register(`device-${randomUUID()}@example.com`, 'a secure password');
    await auth.verifyEmail(mailer.verificationTokens.at(-1)!);

    const device = await auth.startDeviceAuthorization();
    await auth.approveDevice(device.userCode, registered.id);
    const session = await auth.exchangeDevice(device.deviceCode);

    expect(session.accessToken).toEqual(expect.any(String));
    await sqlClient`delete from users where id = ${registered.id}`;
  });
});
