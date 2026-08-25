import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // linkedom, not jsdom: it is the DOM the Python runtime loads (see js/env.js), and
    // jsdom disagrees with it on XML documents — the MEI is one — by returning a selector
    // list's matches grouped by selector rather than in document order.
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/linkedom-env.js', 'tests/setup.js'],
    testTimeout: 10000,
    hookTimeout: 30000,
    // Run test files in parallel (each file gets its own worker/context).
    // Vitest 4 removed poolOptions — these are top-level now.
    pool: 'threads',
    maxWorkers: 11,
    minWorkers: 4,
  },
});
