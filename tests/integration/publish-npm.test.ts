import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(templates = '0.1.9', cli = templates) {
  const root = mkdtempSync(join(tmpdir(), 'publish-npm-test-'));
  directories.push(root);
  for (const dir of ['scripts', 'bin', 'packages/templates', 'apps/cli']) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(resolve('scripts/publish-npm.sh'), join(root, 'scripts/publish-npm.sh'));
  for (const [file, version] of [['packages/templates/package.json', templates], ['apps/cli/package.json', cli]]) {
    writeFileSync(join(root, file), JSON.stringify({ version, description: 'preserved' }, null, 2) + '\n');
  }
  writeFileSync(join(root, 'scripts/verify-npm-package.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\n[ "${FAIL_AUTH:-}" != 1 ] || exit 1\necho test-user\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\n[ "${FAIL_BUILD:-}" != 1 ] || exit 1\nprintf "%s\\n" "$*" >> calls.log\n', { mode: 0o755 });
  return {
    root,
    run: (args: string[] = [], env: Record<string, string> = {}) => spawnSync('bash', [join(root, 'scripts/publish-npm.sh'), ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, NPM_TOKEN: 'fake-test-token', NPM_OTP: '', NPM_CREDENTIALS_FILE: join(root, 'missing'), ...env },
    }),
    versions: () => ['packages/templates/package.json', 'apps/cli/package.json'].map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')).version),
  };
}

test('increments patch by default and publishes templates before CLI', () => {
  const f = fixture();
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(f.versions()).toEqual(['0.1.10', '0.1.10']);
  expect(readFileSync(join(f.root, 'calls.log'), 'utf8')).toMatch(/build\n--filter @vibeplan\/templates publish.*\n--filter @vibeplan\/cli publish/);
});

test('explicit version synchronizes both packages, including retries', () => {
  const f = fixture('0.1.9', '0.1.8');
  expect(f.run(['0.2.0']).status).toBe(0);
  expect(f.run(['0.2.0']).status).toBe(0);
  expect(f.versions()).toEqual(['0.2.0', '0.2.0']);
});

test('options can be supplied without a version', () => {
  const f = fixture();
  expect(f.run(['--otp', '123456', '--registry', 'https://example.test']).status).toBe(0);
  expect(f.versions()).toEqual(['0.1.10', '0.1.10']);
  expect(readFileSync(join(f.root, 'calls.log'), 'utf8')).toContain('--registry https://example.test --otp 123456');
});

test('mismatched versions and invalid arguments fail without changes', () => {
  const f = fixture('0.1.9', '0.1.8');
  for (const args of [[], ['bad'], ['01.2.3'], ['0.2.0', '0.3.0'], ['--otp'], ['--unknown']]) {
    expect(f.run(args).status).not.toBe(0);
    expect(f.versions()).toEqual(['0.1.9', '0.1.8']);
  }
});

test('authentication failure and help do not change versions', () => {
  const f = fixture();
  expect(f.run([], { FAIL_AUTH: '1' }).status).not.toBe(0);
  expect(f.run(['--help']).status).toBe(0);
  expect(f.versions()).toEqual(['0.1.9', '0.1.9']);
});

test('build failure retains selected version and explains explicit retry', () => {
  const f = fixture();
  const result = f.run([], { FAIL_BUILD: '1' });
  expect(result.status).not.toBe(0);
  expect(f.versions()).toEqual(['0.1.10', '0.1.10']);
  expect(result.stderr).toContain('scripts/publish-npm.sh 0.1.10');
});
