import keytar from 'keytar';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const serviceName = 'vibe-plan';
const accountName = 'session';

export type Session = { server: string; accessToken: string; refreshToken: string };

export async function saveSession(session: Session): Promise<void> {
  await withSessionLock(() => sessionStore.save(session));
}

export async function loadSession(): Promise<Session | undefined> {
  const value = await keytar.getPassword(serviceName, accountName);
  return value ? JSON.parse(value) as Session : undefined;
}

export async function clearSession(): Promise<void> {
  await withSessionLock(() => sessionStore.clear());
}

// Use these only while holding the shared lock, to avoid nested acquisition.
export const sessionStore = {
  load: loadSession,
  save: async (session: Session) => { await keytar.setPassword(serviceName, accountName, JSON.stringify(session)); },
  clear: async () => { await keytar.deletePassword(serviceName, accountName); },
};

export async function withSessionLock<T>(action: () => Promise<T>, directory = join(homedir(), '.vibeplan')): Promise<T> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'session.lock');
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const before = statSync(path);
        const pid = Number(readFileSync(path, 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (probeError) {
            if ((probeError as NodeJS.ErrnoException).code === 'ESRCH' && statSync(path).ino === before.ino) unlinkSync(path);
          }
        }
      } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== 'ENOENT') throw probeError;
      }
      if (Date.now() >= deadline) throw new Error('登录会话正在由其他进程更新，请稍后重试；登录凭据已保留。');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try { return await action(); } finally { unlinkSync(path); }
}
