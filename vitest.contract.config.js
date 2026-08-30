/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Vitest config for the storage contract test suite.
 *
 * Run with:  yarn test:contract              (sqlite backend, default)
 *            STORAGE_BACKEND=firestore yarn test:contract   (Phase 2+)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/contract/**/*.contract.test.js'],
    setupFiles: ['./test/contract/setup.js'],
    testTimeout: 30000,
    reporters: ['verbose'],
    // Each worker gets its own temp DB dir (setup.js), but keep it simple:
    // one worker, sequential files. The suite is small and fast.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
