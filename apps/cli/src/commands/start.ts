import { AuthenticationRequiredError } from '../errors.js';

export type StartResult = { pid: number; alreadyRunning: boolean };
export type StartCommand = () => Promise<StartResult>;
export type Authenticate = (server?: string) => Promise<boolean>;

/** Retry start once after an explicitly completed interactive login. */
export async function startWithLogin(start: StartCommand, authenticate: Authenticate): Promise<StartResult> {
  try {
    return await start();
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    if (!await authenticate(error.server)) throw error;
    return start();
  }
}
