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
  if (isServerUnavailableError(error)) {
    const status = error instanceof Error ? (error as { status?: unknown }).status : undefined;
    if (typeof status === 'number') return `Vibe Plan 服务端暂时不可用（HTTP ${status}）。请稍后重试；可运行 \`vibeplan status\` 检查连接。`;
    return '无法连接 Vibe Plan 服务端。请确认服务端已启动，检查网络后重试；可运行 `vibeplan status` 检查连接。';
  }
  return error instanceof Error ? error.message : '命令执行失败。';
}

function isServerUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status >= 500;
  return ['AbortError', 'TimeoutError'].includes(error.name) || (error.name === 'TypeError' && /fetch failed|failed to fetch|network/i.test(error.message));
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
