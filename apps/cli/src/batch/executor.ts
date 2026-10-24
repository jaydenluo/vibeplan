import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface CodexResult {
  summary: string;
  outcome: 'success' | 'failed' | 'blocked';
  changedFiles: string[];
  criteria: Array<{ id: string; passed: boolean; reason: string }>;
  remainingIssues: string[];
}

const maxLogBytes = 1024 * 1024;
const maxResultBytes = 64 * 1024;
const schema = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'outcome', 'changedFiles', 'criteria', 'remainingIssues'],
  properties: {
    summary: { type: 'string' }, outcome: { type: 'string', enum: ['success', 'failed', 'blocked'] },
    changedFiles: { type: 'array', items: { type: 'string' } },
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'passed', 'reason'], properties: { id: { type: 'string' }, passed: { type: 'boolean' }, reason: { type: 'string' } } } },
    remainingIssues: { type: 'array', items: { type: 'string' } },
  },
};

// Preserve CLI configuration/auth paths, without forwarding unrelated application credentials.
function subprocessEnv(codex: boolean): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CI'];
  if (codex) names.push('CODEX_HOME', 'OPENAI_API_KEY');
  return Object.fromEntries(names.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
}

interface ProcessResult { exitCode: number; output: string; interruption?: string }

async function execute(root: string, argv: string[], logFile: string, timeoutMs: number, input?: string, codex = false): Promise<ProcessResult> {
  if (!argv.length || argv.some(arg => typeof arg !== 'string') || !argv[0]) throw new Error('A nonempty command argv is required');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error('timeoutMs must be a positive bounded duration');
  await mkdir(resolve(logFile, '..'), { recursive: true });
  await writeFile(logFile, '');
  return new Promise(resolveResult => {
    let output = '';
    let logBytes = 0;
    let interruption: string | undefined;
    let finished = false;
    const child = spawn(argv[0], argv.slice(1), { cwd: root, env: subprocessEnv(codex), shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const record = (chunk: Buffer, stream: NodeJS.WriteStream) => {
      if (logBytes < maxLogBytes) {
        const bounded = chunk.subarray(0, maxLogBytes - logBytes);
        appendFileSync(logFile, bounded);
        logBytes += bounded.length;
        stream.write(bounded);
      }
      if (Buffer.byteLength(output) < maxResultBytes) output += chunk.subarray(0, maxResultBytes - Buffer.byteLength(output)).toString('utf8');
    };
    const stop = (reason: string) => {
      interruption = reason;
      if (child.pid) {
        try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); }
        catch { child.kill('SIGKILL'); }
      }
    };
    const onInterrupt = () => stop('Interrupted by SIGINT');
    const onTerminate = () => stop('Interrupted by SIGTERM');
    const timer = setTimeout(() => stop(`Process timed out after ${timeoutMs}ms`), timeoutMs);
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    const finish = (exitCode: number, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      if (error) output += `\n${error.message}`;
      resolveResult({ exitCode, output, interruption });
    };
    child.stdout.on('data', chunk => record(chunk, process.stdout));
    child.stderr.on('data', chunk => record(chunk, process.stderr));
    child.on('error', error => finish(-1, error));
    child.on('close', code => finish(code ?? -1));
    // Early child exits can close stdin before the entire prompt is written.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function validResult(value: unknown): value is CodexResult {
  return exactObject(value, ['summary', 'outcome', 'changedFiles', 'criteria', 'remainingIssues'])
    && typeof value.summary === 'string' && typeof value.outcome === 'string' && ['success', 'failed', 'blocked'].includes(value.outcome)
    && strings(value.changedFiles) && strings(value.remainingIssues) && Array.isArray(value.criteria)
    && value.criteria.every(item => exactObject(item, ['id', 'passed', 'reason']) && typeof item.id === 'string' && typeof item.passed === 'boolean' && typeof item.reason === 'string');
}
function failure(summary: string, outcome: 'failed' | 'blocked' = 'failed'): CodexResult {
  return { summary, outcome, changedFiles: [], criteria: [], remainingIssues: [summary] };
}

export async function runCodex(options: { root: string; prompt: string; mode: 'implement' | 'review'; outputDir: string; timeoutMs: number }): Promise<CodexResult> {
  const { root, prompt, mode, timeoutMs } = options;
  const outputDir = resolve(options.outputDir);
  try {
    if (mode !== 'implement' && mode !== 'review') throw new Error('Invalid Codex execution mode');
    await mkdir(outputDir, { recursive: true });
    const schemaFile = join(outputDir, 'output-schema.json');
    const finalFile = join(outputDir, 'codex-result.json');
    await writeFile(schemaFile, JSON.stringify(schema));
    // Never reuse output from an earlier run if the process fails to produce a final message.
    await writeFile(finalFile, '');
    const result = await execute(root, ['codex', 'exec', '--sandbox', mode === 'implement' ? 'workspace-write' : 'read-only', '--output-schema', schemaFile, '-o', finalFile, '-'], join(outputDir, 'codex.log'), timeoutMs, prompt, true);
    if (result.interruption) return failure(result.interruption, 'blocked');
    if (result.exitCode !== 0) return failure(`Codex exited with code ${result.exitCode}: ${result.output}`);
    if ((await stat(finalFile)).size > maxLogBytes) return failure('Codex structured output exceeded the size limit');
    const parsed: unknown = JSON.parse(await readFile(finalFile, 'utf8'));
    if (!validResult(parsed)) return failure('Codex returned invalid structured output');
    return parsed;
  } catch (error) { return failure(`Codex execution failed: ${error instanceof Error ? error.message : String(error)}`); }
}

export async function runCheck(root: string, argv: string[], outputDir: string, timeoutMs: number): Promise<{ command: string; result: string; outcome: 'passed' | 'failed'; exitCode: number }> {
  // JSON argv retains exact boundaries, including arguments containing spaces or shell syntax.
  const command = JSON.stringify(argv);
  try {
    const result = await execute(root, argv, join(resolve(outputDir), 'check.log'), timeoutMs);
    return { command, result: [result.output, result.interruption].filter(Boolean).join('\n'), outcome: result.exitCode === 0 && !result.interruption ? 'passed' : 'failed', exitCode: result.exitCode };
  } catch (error) { return { command, result: error instanceof Error ? error.message : String(error), outcome: 'failed', exitCode: -1 }; }
}
