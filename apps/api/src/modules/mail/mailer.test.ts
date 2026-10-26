import { describe, expect, it, vi } from 'vitest';
import { EmailDeliveryError, SmtpMailer, type MailTransport } from './mailer.js';

const validEnvironment = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'secret',
  SMTP_FROM: 'VibePlan <no-reply@example.com>',
  APP_BASE_URL: 'https://vibeplan.example.com',
};

describe('SmtpMailer', () => {
  it('rejects delivery when SMTP configuration is incomplete', () => {
    const mailer = new SmtpMailer({ ...validEnvironment, SMTP_PASSWORD: '' });

    expect(mailer.isConfigured()).toBe(false);
    expect(() => mailer.assertConfigured()).toThrow(EmailDeliveryError);
    expect(() => mailer.assertConfigured()).toThrow(expect.objectContaining({ code: 'EMAIL_DELIVERY_NOT_CONFIGURED' }));
  });

  it('hands a registration code to the configured transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-1' });
    const mailer = new SmtpMailer(validEnvironment, { sendMail } satisfies MailTransport);

    await mailer.sendRegistrationCode('member@example.com', '123456');

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: validEnvironment.SMTP_FROM,
      to: 'member@example.com',
      subject: 'VibePlan 注册验证码',
      text: expect.stringContaining('123456'),
    }));
  });

  it('converts an SMTP rejection into a safe delivery error', async () => {
    const mailer = new SmtpMailer(validEnvironment, {
      sendMail: async () => { throw new Error('SMTP authentication failed for secret'); },
    });

    await expect(mailer.sendPasswordReset('member@example.com', 'reset-token')).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_FAILED',
      message: 'Email delivery failed.',
    });
  });
});
