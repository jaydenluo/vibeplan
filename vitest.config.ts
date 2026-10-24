import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    // API integration tests share one PostgreSQL database. File-level
    // concurrency lets unrelated cleanup transactions deadlock each other.
    fileParallelism: false,
  },
});
