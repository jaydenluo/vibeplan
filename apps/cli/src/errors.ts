import { loadSession, type Session } from './auth.js';

export class AuthenticationRequiredError extends Error {
  constructor(readonly server?: string) {
    super('Authentication is required.');
    this.name = 'AuthenticationRequiredError';
  }
}

export async function requireSession(): Promise<Session> {
  const session = await loadSession();
  if (!session) throw new AuthenticationRequiredError();
  return session;
}

export function cliErrorMessage(error: unknown): string {
  if (error instanceof AuthenticationRequiredError) {
    return '未登录或登录已过期，请先运行 `vibeplan login`。';
  }
  return error instanceof Error ? error.message : '命令执行失败。';
}

export function shouldStartLogin(answer: string): boolean {
  return answer.trim() === '1';
}

export async function chooseLogin(question: () => Promise<string>): Promise<boolean> {
  try {
    return shouldStartLogin(await question());
  } catch {
    return false;
  }
}
