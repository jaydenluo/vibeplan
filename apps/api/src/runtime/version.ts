export function serverVersion() {
  const buildCommit = process.env.BUILD_COMMIT ?? 'development';
  return { version: process.env.APP_VERSION ?? 'development', buildCommit, commit: buildCommit, protocolVersion: 1,
    capabilities: ['mutation-id', 'sync-feed', 'structured-tests', 'my-work', 'contributions', 'work-log-edit'] };
}
