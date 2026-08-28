import { defineConfig } from 'vitest/config';

// The timing harness, kept out of `npm test` by living behind its own include pattern.
// Same environment as the suite: linkedom, which is what chorister.js ships on.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.perf.js'],
    setupFiles: ['tests/linkedom-env.js', 'tests/setup.js'],
    testTimeout: 300000,
    hookTimeout: 60000,
    // One file, one worker: parallel loads would contend and blur the timings
    pool: 'threads',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
