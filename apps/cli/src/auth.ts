import keytar from 'keytar';

const serviceName = 'vibe-plan';
const accountName = 'session';

export type Session = { server: string; accessToken: string; refreshToken: string };

export async function saveSession(session: Session): Promise<void> {
  await keytar.setPassword(serviceName, accountName, JSON.stringify(session));
}

export async function loadSession(): Promise<Session | undefined> {
  const value = await keytar.getPassword(serviceName, accountName);
  return value ? JSON.parse(value) as Session : undefined;
}

export async function clearSession(): Promise<void> {
  await keytar.deletePassword(serviceName, accountName);
}
