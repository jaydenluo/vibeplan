import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';

const run = promisify(execFile);
test('packed authenticated CLI commands use real isolated API and retry committed mutations once', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'vibeplan-packed-e2e-'));
  try {
    const result = await run('bash', ['scripts/verify-npm-package.sh'], {
      cwd: process.cwd(), timeout: 80_000,
      env: { ...process.env, VIBEPLAN_PACKED_API: 'http://localhost:4401', VIBEPLAN_PACKED_TEST_SCRIPT: join(process.cwd(), 'tests/e2e/packed-cli-runner.mjs'), VIBEPLAN_PACKED_TEST_ROOT: directory },
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(result.stdout).toContain('Packed authenticated API workflow passed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
