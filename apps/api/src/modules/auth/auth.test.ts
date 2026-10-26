import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../db/migrate.js';
import { db, sqlClient } from '../../db/client.js';
import { EmailDeliveryError } from '../mail/mailer.js';
import { AuthService, AuthError, type Mailer } from './service.js';

class TestMailer implements Mailer {
  verificationTokens: string[] = [];
  registrationCodes: string[] = [];

  isConfigured(): boolean { return true; }
  assertConfigured(): void {}

  async sendRegistrationCode(_email: string, code: string): Promise<void> {
    this.registrationCodes.push(code);
  }

  async sendVerification(_email: string, token: string): Promise<void> {
    this.verificationTokens.push(token);
  }

  async sendPasswordReset(_email: string, token: string): Promise<void> {
    this.verificationTokens.push(token);
  }
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

describe('email authentication', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('requires verified email before login and rotates refresh tokens', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });
    const email = `alice-${randomUUID()}@example.com`;

    await auth.requestRegistrationCode(` ${email.toUpperCase()} `);
    const registered = await auth.register(` ${email.toUpperCase()} `, 'correct horse battery staple', 'Alice', mailer.registrationCodes[0]);
    const firstSession = await auth.login(email.toUpperCase(), 'correct horse battery staple');
    const secondSession = await auth.refresh(firstSession.refreshToken);

    expect(registered.email).toBe(email);
    expect(secondSession.refreshToken).not.toBe(firstSession.refreshToken);
    await expect(auth.refresh(firstSession.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('renews the default refresh session for 90 days after each use', async () => {
    const mailer = new TestMailer();
    let now = new Date('2026-10-02T00:00:00.000Z');
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}`, now: () => now });
    const email = `sliding-${randomUUID()}@example.com`;

    await auth.requestRegistrationCode(email);
    const registered = await auth.register(email, 'a secure password', 'Sliding User', mailer.registrationCodes.at(-1)!);
    const initialSession = await auth.login(email, 'a secure password');
    expect(initialSession.refreshExpiresInSeconds).toBe(90 * 24 * 60 * 60);

    now = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000);
    const renewedSession = await auth.refresh(initialSession.refreshToken);
    expect(renewedSession.refreshExpiresInSeconds).toBe(90 * 24 * 60 * 60);

    now = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await expect(auth.refresh(renewedSession.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });

    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('rejects duplicate normalized emails', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });

    const email = `duplicate-${randomUUID()}@example.com`;
    await auth.requestRegistrationCode(email);
    const registered = await auth.register(email, 'a secure password', 'Duplicate', mailer.registrationCodes[0]);
    await expect(auth.register(` ${registered.email.toUpperCase()} `, 'another secure password', 'Duplicate', mailer.registrationCodes[0])).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('exchanges an approved device code for a session', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });
    const email = `device-${randomUUID()}@example.com`;
    await auth.requestRegistrationCode(email);
    const registered = await auth.register(email, 'a secure password', 'Device User', mailer.registrationCodes.at(-1)!);

    const device = await auth.startDeviceAuthorization();
    await auth.approveDevice(device.userCode, registered.id);
    const session = await auth.exchangeDevice(device.deviceCode);

    expect(session.accessToken).toEqual(expect.any(String));
    await expect(auth.exchangeDevice(device.deviceCode)).rejects.toMatchObject({ code: 'DEVICE_AUTHORIZATION_PENDING' });
    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('updates a user display name without changing the email', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}` });
    const email = `profile-${randomUUID()}@example.com`;
    await auth.requestRegistrationCode(email);
    const registered = await auth.register(email, 'a secure password', 'Profile User', mailer.registrationCodes.at(-1)!);
    const updated = await auth.updateProfile(registered.id, '项目负责人');

    expect(updated).toMatchObject({ id: registered.id, email: registered.email, displayName: '项目负责人' });
    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('allows direct verified registration when email verification is disabled', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}`, emailVerificationRequired: false });
    const email = `direct-${randomUUID()}@example.com`;
    const registered = await auth.register(email, 'a secure password', 'Direct User');
    const session = await auth.login(email, 'a secure password');
    expect(session.accessToken).toEqual(expect.any(String));
    expect(registered.email).toBe(email);
    expect(mailer.registrationCodes).toHaveLength(0);
    await sqlClient`delete from users where id = ${registered.id}`;
  });

  it('does not persist a registration code when email delivery is unavailable', async () => {
    const email = `unavailable-code-${randomUUID()}@example.com`;
    const auth = new AuthService(db, new UnavailableMailer(), { accessSecret: 'unavailable-code-test' });

    await expect(auth.requestRegistrationCode(email)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_NOT_CONFIGURED' });
    const [{ count }] = await sqlClient<{ count: string }[]>`select count(*)::text as count from registration_codes where email = ${email}`;

    expect(count).toBe('0');
  });

  it('does not persist a password reset token when email delivery is unavailable', async () => {
    const email = `unavailable-reset-${randomUUID()}@example.com`;
    const auth = new AuthService(db, new UnavailableMailer(), { accessSecret: 'unavailable-reset-test', emailVerificationRequired: false });
    const user = await auth.register(email, 'old secure password', 'Reset User');

    await expect(auth.requestPasswordReset(email)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_NOT_CONFIGURED' });
    const [{ count }] = await sqlClient<{ count: string }[]>`select count(*)::text as count from email_tokens where user_id = ${user.id} and purpose = 'reset_password'`;

    expect(count).toBe('0');
    await sqlClient`delete from users where id = ${user.id}`;
  });

  it('atomically rotates a refresh token once and reports the configured access TTL', async () => {
    const auth = new AuthService(db, new TestMailer(), { accessSecret: 'rotation-test', emailVerificationRequired: false, accessTokenTtl: '2s' });
    const email = `${randomUUID()}@example.com`;
    const user = await auth.register(email, 'a secure password', 'Refresh');
    try {
      const session = await auth.login(email, 'a secure password');
      expect(session.expiresInSeconds).toBe(2);
      const results = await Promise.allSettled([auth.refresh(session.refreshToken), auth.refresh(session.refreshToken)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    } finally { await sqlClient`delete from users where id=${user.id}`; }
  });

  it('resets a password with a one-time token and revokes existing sessions', async () => {
    const mailer = new TestMailer();
    const auth = new AuthService(db, mailer, { accessSecret: `test-${randomUUID()}`, emailVerificationRequired: false });
    const email = `reset-${randomUUID()}@example.com`;
    const user = await auth.register(email, 'old secure password', 'Reset User');
    const session = await auth.login(email, 'old secure password');
    await auth.requestPasswordReset(email);
    const token = mailer.verificationTokens.at(-1)!;
    await auth.resetPassword(token, 'new secure password');
    await expect(auth.login(email, 'old secure password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login(email, 'new secure password')).resolves.toEqual(expect.objectContaining({ accessToken: expect.any(String) }));
    await expect(auth.refresh(session.refreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    await expect(auth.resetPassword(token, 'another password')).rejects.toMatchObject({ code: 'INVALID_PASSWORD_RESET_TOKEN' });
    await sqlClient`delete from users where id = ${user.id}`;
  });
});
