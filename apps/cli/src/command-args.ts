const taskCommands = new Set(['task:start', 'task:report', 'task:accept', 'task:plan', 'task:progress', 'task:update']);

export function normalizeTaskVersionOption(argv: string[]): string[] {
  if (!taskCommands.has(argv[2] ?? '')) return argv;
  const versionIndex = argv.indexOf('--version', 3);
  if (versionIndex < 0) return argv;
  const normalized = [...argv];
  normalized[versionIndex] = '--task-version';
  return normalized;
}
