import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { withSessionLock } from './auth.js';

vi.mock('keytar', () => ({ default: {} }));

it('waits for another process holding the shared session lock', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'vibeplan-auth-lock-'));
  const path = join(directory, 'session.lock');
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    'import {writeFileSync,unlinkSync} from "node:fs"; const path=process.argv[1]; writeFileSync(path,String(process.pid),{flag:"wx"}); console.log("locked"); process.stdin.once("data",()=>{unlinkSync(path);process.exit(0);});', path], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    let entered = false;
    const waiting = withSessionLock(async () => { entered = true; }, directory);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(entered).toBe(false);
    child.stdin.write('release');
    await waiting;
    expect(entered).toBe(true);
    expect(existsSync(path)).toBe(false);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
