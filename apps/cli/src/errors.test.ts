import { describe, expect, it } from 'vitest';
import { AuthenticationRequiredError, chooseLogin, cliErrorMessage, shouldStartLogin } from './errors.js';

describe('CLI error messages', () => {
  it('guides unauthenticated users to log in without exposing a stack trace', () => {
    expect(cliErrorMessage(new AuthenticationRequiredError())).toBe('未登录或登录已过期，请先运行 `vibeplan login`。');
  });

  it('keeps ordinary command errors readable', () => {
    expect(cliErrorMessage(new Error('Missing .vibe/project.yaml.'))).toBe('Missing .vibe/project.yaml.');
  });

  it('only starts login for the explicit first option', () => {
    expect(shouldStartLogin('1')).toBe(true);
    expect(shouldStartLogin(' 1 ')).toBe(true);
    expect(shouldStartLogin('2')).toBe(false);
    expect(shouldStartLogin('')).toBe(false);
  });

  it('treats a closed prompt as a cancelled login', async () => {
    await expect(chooseLogin(async () => { throw new Error('input closed'); })).resolves.toBe(false);
  });
});
