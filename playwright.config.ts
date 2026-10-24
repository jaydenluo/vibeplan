import { defineConfig } from '@playwright/test';

// Deliberately fixed: E2E must never inherit a production URL or database.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:4402', trace: 'retain-on-failure', actionTimeout: 10_000, navigationTimeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: [
    { command: 'pnpm --filter @vibeplan/api exec tsx ../../tests/e2e/server.ts', url: 'http://localhost:4401/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'pnpm --filter @vibeplan/web exec vite --host localhost --port 4402 --strictPort --mode e2e', url: 'http://localhost:4402', reuseExistingServer: false,
      env: { VITE_API_URL: 'http://localhost:4401', VITE_API_PROXY_TARGET: '', VITE_APP_VERSION: 'e2e', VITE_BUILD_COMMIT: 'local-test' } },
  ],
});
