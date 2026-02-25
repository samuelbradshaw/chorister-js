import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    testTimeout: 10000,
    hookTimeout: 30000,
    // Run test files in parallel (each file gets its own worker/context)
    pool: 'threads',
    poolOptions: {
      threads: {
        // Allow all 11 test files to run concurrently
        maxThreads: 11,
        minThreads: 4,
      },
    },
  },
});
