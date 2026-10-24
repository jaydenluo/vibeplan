import { execFileSync } from 'node:child_process';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function paths(output: string): string[] { return output.split('\0').filter(Boolean); }

/** Filenames only: never read source contents, remotes or credentials. */
export function collectGitContext(root = process.cwd()) {
  try {
    const uncommittedFiles = [...new Set([
      ...paths(git(root, ['diff', '--name-only', '-z'])),
      ...paths(git(root, ['diff', '--cached', '--name-only', '-z'])),
      ...paths(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])),
    ])].filter((path) => !path.startsWith('.vibe/')).sort();
    let head: string | null = null;
    try { head = git(root, ['rev-parse', '--verify', 'HEAD']).trim(); } catch { /* Unborn branch. */ }
    return { available: true, branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), head, uncommittedFiles, warning: 'Git files are candidates, not task attribution or proof of passing tests. Review scope before reporting.' };
  } catch {
    return { available: false, branch: null, head: null, uncommittedFiles: [], warning: 'Git context unavailable; task context is still usable.' };
  }
}

export function collectGitReport(root: string, base: string, selectedFiles?: string[]) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base)) throw new Error('Git base must be a commit SHA or a safe local ref.');
  let baseCommit: string;
  let head: string;
  try {
    baseCommit = git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
    head = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
    git(root, ['merge-base', '--is-ancestor', baseCommit, head]);
  } catch {
    throw new Error('Git base must exist and be an ancestor of HEAD; no report was submitted.');
  }
  const candidates = paths(git(root, ['diff', '--name-only', '-z', baseCommit, head, '--'])).filter((path) => !path.startsWith('.vibe/'));
  const changedFiles = selectedFiles?.length ? candidates.filter((path) => selectedFiles.includes(path)) : candidates;
  const warnings = ['Git evidence covers committed changes since the chosen base. Verify that those commits belong to this task; it does not prove tests or acceptance.'];
  if (collectGitContext(root).uncommittedFiles.length) warnings.push('Uncommitted changes were not automatically included. Supply their task-scoped filenames explicitly if required.');
  return { changedFiles, commit: baseCommit === head ? null : head, warnings };
}
