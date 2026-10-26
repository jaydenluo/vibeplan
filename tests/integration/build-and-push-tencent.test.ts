import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(templates = '0.1.9', cli = templates) {
  const root = mkdtempSync(join(tmpdir(), 'build-push-test-'));
  directories.push(root);
  for (const dir of ['scripts', 'bin', 'packages/templates', 'apps/cli']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'scripts/build-and-push-tencent.sh'), readFileSync('scripts/build-and-push-tencent.sh'));
  writeFileSync(join(root, 'packages/templates/package.json'), JSON.stringify({ version: templates }) + '\n');
  writeFileSync(join(root, 'apps/cli/package.json'), JSON.stringify({ version: cli }) + '\n');
  writeFileSync(join(root, 'scripts/tencent-credentials.env'), 'TENCENT_CCR_USERNAME=test-user\nTENCENT_CCR_PASSWORD=test-password\n');
  writeFileSync(join(root, 'bin/docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> docker.log\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/git'), '#!/bin/sh\nprintf "test-commit"\n', { mode: 0o755 });
  return {
    root,
    run: (args: string[] = []) => spawnSync('bash', [join(root, 'scripts/build-and-push-tencent.sh'), ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TENCENT_CREDENTIALS_FILE: join(root, 'scripts/tencent-credentials.env') },
    }),
    versions: () => ['packages/templates/package.json', 'apps/cli/package.json'].map((file) => JSON.parse(readFileSync(join(root, file), 'utf8')).version),
  };
}

test('increments and persists the patch version when omitted', () => {
  const f = fixture();
  expect(f.run().status).toBe(0);
  expect(f.versions()).toEqual(['0.1.10', '0.1.10']);
  expect(readFileSync(join(f.root, 'docker.log'), 'utf8')).toContain('vibe-plan-api:0.1.10');
});

test('uses an explicit version and synchronizes both package manifests', () => {
  const f = fixture('0.1.9', '0.1.8');
  expect(f.run(['0.2.0']).status).toBe(0);
  expect(f.versions()).toEqual(['0.2.0', '0.2.0']);
});

test('rejects mismatched versions in automatic mode without building', () => {
  const f = fixture('0.1.9', '0.1.8');
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('must match');
  expect(f.versions()).toEqual(['0.1.9', '0.1.8']);
});

test('rejects invalid version arguments', () => {
  const f = fixture();
  expect(f.run(['01.2.3']).status).not.toBe(0);
  expect(f.run(['0.2.0', '--unknown']).status).not.toBe(0);
  expect(existsSync(join(f.root, 'docker.log'))).toBe(false);
});
