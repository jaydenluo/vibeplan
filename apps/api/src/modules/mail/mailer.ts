import type { Mailer } from '../auth/service.js';

export class ConsoleMailer implements Mailer {
  async sendVerification(email: string, token: string): Promise<void> {
    console.info(`[vibe-mail] verify ${email} with token ${token}`);
  }
}
