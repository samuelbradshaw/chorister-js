import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 10000,
    hookTimeout: 30000,
    // Run test files in parallel (each file gets its own worker/context).
    // Vitest 4 removed poolOptions — these are top-level now.
    pool: 'threads',
    maxWorkers: 11,
    minWorkers: 4,
  },
});
