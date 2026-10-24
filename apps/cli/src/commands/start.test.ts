import { describe, expect, it, vi } from 'vitest';
import { AuthenticationRequiredError } from '../errors.js';
import { startWithLogin } from './start.js';

describe('vibeplan start login flow', () => {
  it('continues starting after an interactive login succeeds', async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new AuthenticationRequiredError('https://example.com/api'))
      .mockResolvedValueOnce({ pid: 1234, alreadyRunning: false });
    const authenticate = vi.fn().mockResolvedValue(true);

    await expect(startWithLogin(start, authenticate)).resolves.toEqual({ pid: 1234, alreadyRunning: false });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledWith('https://example.com/api');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('does not start when login is declined or unavailable', async () => {
    const start = vi.fn().mockRejectedValue(new AuthenticationRequiredError());
    const authenticate = vi.fn().mockResolvedValue(false);

    await expect(startWithLogin(start, authenticate)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(start).toHaveBeenCalledOnce();
  });

  it('does not repeat login indefinitely when authentication still fails', async () => {
    const start = vi.fn().mockRejectedValue(new AuthenticationRequiredError());
    const authenticate = vi.fn().mockResolvedValue(true);

    await expect(startWithLogin(start, authenticate)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('does not prompt for unrelated startup errors', async () => {
    const start = vi.fn().mockRejectedValue(new Error('project not bound'));
    const authenticate = vi.fn();

    await expect(startWithLogin(start, authenticate)).rejects.toThrow('project not bound');
    expect(authenticate).not.toHaveBeenCalled();
  });
});
