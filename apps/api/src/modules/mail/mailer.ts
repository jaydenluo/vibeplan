import type { Mailer } from '../auth/service.js';

export class ConsoleMailer implements Mailer {
  async sendRegistrationCode(email: string, code: string): Promise<void> {
    console.info(`[vibe-mail] registration code for ${email}: ${code}`);
  }

  async sendVerification(email: string, token: string): Promise<void> {
    console.info(`[vibe-mail] verify ${email} with token ${token}`);
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    console.info(`[vibe-mail] password reset for ${email}: ${token}`);
  }
}
