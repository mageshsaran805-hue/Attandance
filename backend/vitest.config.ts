import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // Database-backed integration tests share one database; run files
    // sequentially so they cannot interfere with each other.
    fileParallelism: false,
  },
});
