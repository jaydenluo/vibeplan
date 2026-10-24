import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGitContext, collectGitReport } from './git-evidence.js';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'vibe-git-evidence-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'base.txt'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
  return { root, git, base: git('rev-parse', 'HEAD') };
}
describe('local Git evidence', () => {
  it('collects only committed changes after a base and keeps dirty files as candidates', () => {
    const { root, git, base } = repo();
    writeFileSync(join(root, 'feature with space.txt'), 'code'); git('add', '.'); git('commit', '-qm', 'feature');
    writeFileSync(join(root, 'base.txt'), 'unrelated local work');
    writeFileSync(join(root, 'new.txt'), 'uncommitted');
    expect(collectGitReport(root, base)).toMatchObject({ changedFiles: ['feature with space.txt'], commit: git('rev-parse', 'HEAD') });
    expect(collectGitContext(root).uncommittedFiles).toEqual(['base.txt', 'new.txt']);
    expect(collectGitReport(root, base).warnings).not.toHaveLength(0);
    expect(collectGitReport(root, base, ['base.txt', 'feature with space.txt']).changedFiles).toEqual(['feature with space.txt']);
  });
  it('does not treat HEAD as new evidence when there are no new commits', () => {
    const { root, base } = repo();
    expect(collectGitReport(root, base)).toMatchObject({ changedFiles: [], commit: null });
  });
  it('rejects invalid bases and supports unavailable Git without preventing context reads', () => {
    const { root } = repo();
    expect(() => collectGitReport(root, '--help')).toThrow();
    expect(() => collectGitReport(root, 'missing-ref')).toThrow();
    expect(collectGitContext(mkdtempSync(join(tmpdir(), 'vibe-no-git-')))).toMatchObject({ available: false });
  });
});
