import nodemailer from 'nodemailer';
import type { Mailer } from '../auth/service.js';

type Environment = Record<string, string | undefined>;

type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

export type MailTransport = {
  sendMail(message: MailMessage): Promise<unknown>;
};

type SmtpConfiguration = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  appBaseUrl: URL;
};

export class EmailDeliveryError extends Error {
  constructor(public readonly code: 'EMAIL_DELIVERY_NOT_CONFIGURED' | 'EMAIL_DELIVERY_FAILED', message: string) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

function configuredValue(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function applicationBaseUrl(environment: Environment): string | undefined {
  const explicitUrl = configuredValue(environment, 'APP_BASE_URL');
  if (explicitUrl) return explicitUrl;

  const legacyDomain = configuredValue(environment, 'VIBE_PLAN_DOMAIN');
  return legacyDomain ? `https://${legacyDomain}` : undefined;
}

function readConfiguration(environment: Environment): SmtpConfiguration | undefined {
  const host = configuredValue(environment, 'SMTP_HOST');
  const user = configuredValue(environment, 'SMTP_USER');
  const password = configuredValue(environment, 'SMTP_PASSWORD');
  const from = configuredValue(environment, 'SMTP_FROM');
  const port = Number(configuredValue(environment, 'SMTP_PORT'));
  const baseUrl = applicationBaseUrl(environment);
  if (!host || !user || !password || !from || !Number.isInteger(port) || port < 1 || port > 65535 || !baseUrl) return undefined;

  try {
    const appBaseUrl = new URL(baseUrl);
    if (appBaseUrl.protocol !== 'http:' && appBaseUrl.protocol !== 'https:') return undefined;
    return { host, port, user, password, from, appBaseUrl };
  } catch {
    return undefined;
  }
}

export class SmtpMailer implements Mailer {
  private readonly configuration: SmtpConfiguration | undefined;
  private readonly transport: MailTransport | undefined;

  constructor(environment: Environment = process.env, transport?: MailTransport) {
    this.configuration = readConfiguration(environment);
    this.transport = this.configuration
      ? transport ?? nodemailer.createTransport({
        host: this.configuration.host,
        port: this.configuration.port,
        secure: this.configuration.port === 465,
        auth: { user: this.configuration.user, pass: this.configuration.password },
      })
      : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.configuration);
  }

  assertConfigured(): void {
    if (!this.configuration || !this.transport) {
      throw new EmailDeliveryError('EMAIL_DELIVERY_NOT_CONFIGURED', 'Email delivery is not configured.');
    }
  }

  async sendRegistrationCode(email: string, code: string): Promise<void> {
    await this.send({
      email,
      subject: 'VibePlan 注册验证码',
      text: `你的 VibePlan 注册验证码是：${code}\n\n验证码 10 分钟内有效。若非本人操作，请忽略此邮件。`,
    });
  }

  async sendVerification(email: string, token: string): Promise<void> {
    const verificationUrl = this.url('/verify-email', token);
    await this.send({
      email,
      subject: '验证你的 VibePlan 邮箱',
      text: `请打开以下链接验证你的邮箱：\n${verificationUrl}\n\n链接 24 小时内有效。若非本人操作，请忽略此邮件。`,
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = this.url('/reset-password', token);
    await this.send({
      email,
      subject: '重置你的 VibePlan 密码',
      text: `请打开以下链接重置密码：\n${resetUrl}\n\n链接 30 分钟内有效。若非本人操作，请忽略此邮件。`,
    });
  }

  private url(pathname: string, token: string): string {
    this.assertConfigured();
    const url = new URL(pathname, this.configuration!.appBaseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async send({ email, subject, text }: { email: string; subject: string; text: string }): Promise<void> {
    this.assertConfigured();
    try {
      await this.transport!.sendMail({ from: this.configuration!.from, to: email, subject, text });
    } catch {
      console.warn('[vibe-mail] SMTP delivery failed.');
      throw new EmailDeliveryError('EMAIL_DELIVERY_FAILED', 'Email delivery failed.');
    }
  }
}
