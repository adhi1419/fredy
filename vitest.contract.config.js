/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Vitest config for the storage contract test suite.
 *
 * Run with: FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/contract/**/*.contract.test.js'],
    testTimeout: 30000,
    reporters: ['verbose'],
    // Contract files share one emulator database. Keep both file execution and
    // workers sequential so per-test resets cannot race across files.
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
  },
});
