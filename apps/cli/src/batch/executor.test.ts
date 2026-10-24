import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck, runCodex } from './executor.js';

const response = { summary: 'Implemented', outcome: 'success', changedFiles: ['src/a.ts'], criteria: [{ id: 'ac1', passed: true, reason: 'Verified' }], remainingIssues: [] };
let root: string;
let originalPath: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'vibe-executor-'));
  originalPath = process.env.PATH;
  process.env.PATH = `${root}:${originalPath}`;
  await writeFile(join(root, 'codex'), `#!${process.execPath}
const fs = require('node:fs');
const cfg = JSON.parse(fs.readFileSync('fixture.json', 'utf8'));
const args = process.argv.slice(2);
let prompt = '';
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync('invocation.json', JSON.stringify({args, prompt, env: process.env, cwd: process.cwd()}));
  process.stdout.write('executing\\n'); process.stderr.write('diagnostic\\n');
  if (cfg.hang) { setInterval(() => {}, 1000); return; }
  if (cfg.exit) process.exit(cfg.exit);
  fs.writeFileSync(args[args.indexOf('-o') + 1], cfg.raw ?? JSON.stringify(cfg.response));
});
`);
  await chmod(join(root, 'codex'), 0o755);
});
afterEach(async () => { process.env.PATH = originalPath; delete process.env.VIBE_API_TOKEN; delete process.env.TENCENT_SECRET_KEY; await rm(root, { recursive: true, force: true }); });
async function codex(config: Record<string, unknown>, mode: 'implement' | 'review' = 'implement', timeoutMs = 3000) {
  await writeFile(join(root, 'fixture.json'), JSON.stringify(config));
  return runCodex({ root, prompt: 'Do the authorized work', mode, outputDir: join(root, 'logs'), timeoutMs });
}

describe('runCodex', () => {
  it('passes a stdin prompt and schema with the implementation sandbox and persists logs', async () => {
    expect(await codex({ response })).toEqual(response);
    const invocation = JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8'));
    expect(invocation.prompt).toBe('Do the authorized work');
    expect(invocation.cwd).toBe(await realpath(root));
    expect(invocation.args).toContain('--output-schema');
    expect(invocation.args).toContain('workspace-write');
    expect(invocation.args.at(-1)).toBe('-');
    expect(await readFile(join(root, 'logs', 'codex.log'), 'utf8')).toContain('diagnostic');
  });
  it('uses the read-only sandbox for reviews', async () => {
    await codex({ response }, 'review');
    const invocation = JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8'));
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it('excludes application secrets but preserves saved Codex authentication locations', async () => {
    process.env.VIBE_API_TOKEN = 'private'; process.env.TENCENT_SECRET_KEY = 'private';
    await codex({ response });
    const invocation = JSON.parse(await readFile(join(root, 'invocation.json'), 'utf8'));
    expect(invocation.env.VIBE_API_TOKEN).toBeUndefined();
    expect(invocation.env.TENCENT_SECRET_KEY).toBeUndefined();
    expect(invocation.env.HOME).toBe(process.env.HOME);
  });
  it('reports a nonzero subprocess exit as failure', async () => { expect((await codex({ exit: 7 })).outcome).toBe('failed'); });
  it('reports malformed JSON as failure', async () => { expect((await codex({ raw: 'not-json' })).outcome).toBe('failed'); });
  it('rejects incorrectly typed structured output', async () => { expect((await codex({ response: { ...response, criteria: [{ id: 'ac1', passed: 'yes', reason: 'No' }] } })).outcome).toBe('failed'); });
  it('rejects extra properties and invalid outcomes', async () => {
    expect((await codex({ response: { ...response, fabricated: true } })).outcome).toBe('failed');
    expect((await codex({ response: { ...response, outcome: 'done' } })).outcome).toBe('failed');
    expect((await codex({ response: { ...response, outcome: ['success'] } })).outcome).toBe('failed');
  });
  it('bounds a hanging subprocess lifetime', async () => {
    const start = Date.now();
    const result = await codex({ hang: true }, 'implement', 100);
    expect(result.outcome).toBe('blocked');
    expect(result.remainingIssues.join(' ')).toMatch(/timed out/i);
    expect(Date.now() - start).toBeLessThan(2500);
  });
});
describe('runCheck', () => {
  it('executes literal argv without shell interpolation and records output', async () => {
    const result = await runCheck(root, [process.execPath, '-e', 'console.log(process.argv[1])', '$(touch injected)'], join(root, 'checks'), 3000);
    expect(result.outcome).toBe('passed'); expect(result.exitCode).toBe(0);
    expect(result.result).toContain('$(touch injected)');
    expect(await readFile(join(root, 'checks', 'check.log'), 'utf8')).toContain('$(touch injected)');
  });
  it('records actual failed verification', async () => {
    const result = await runCheck(root, [process.execPath, '-e', 'console.error("failed assertion"); process.exit(3)'], join(root, 'checks'), 3000);
    expect(result.outcome).toBe('failed'); expect(result.exitCode).toBe(3); expect(result.result).toContain('failed assertion');
  });
  it('bounds check lifetime and handles missing executable', async () => {
    expect((await runCheck(root, [process.execPath, '-e', 'setInterval(() => {}, 1000)'], join(root, 'checks'), 100)).outcome).toBe('failed');
    expect((await runCheck(root, ['missing-vibe-check-executable'], join(root, 'missing'), 100)).outcome).toBe('failed');
  });
  it('kills descendants that inherit the process group on timeout', async () => {
    const result = await runCheck(root, [process.execPath, '-e', `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync('child.pid',String(child.pid)); setInterval(()=>{},1000);`], join(root, 'checks'), 500);
    expect(result.result).toMatch(/timed out/);
    const pid = Number(await readFile(join(root, 'child.pid'), 'utf8'));
    for (let attempt = 0; attempt < 20; attempt++) {
      try { process.kill(pid, 0); } catch { return; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('does not forward application secrets to check commands', async () => {
    process.env.VIBE_API_TOKEN = 'private';
    const result = await runCheck(root, [process.execPath, '-e', 'console.log(process.env.VIBE_API_TOKEN ?? "absent")'], join(root, 'checks'), 3000);
    expect(result.result.trim()).toBe('absent');
  });
  it('stops the process on interruption and removes signal listeners', async () => {
    const before = process.listenerCount('SIGINT');
    const running = runCheck(root, [process.execPath, '-e', 'setInterval(()=>{},1000)'], join(root, 'checks'), 3000);
    for (let attempt = 0; attempt < 40 && process.listenerCount('SIGINT') === before; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    process.emit('SIGINT');
    const result = await running;
    expect(result.outcome).toBe('failed'); expect(result.result).toContain('Interrupted by SIGINT');
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
