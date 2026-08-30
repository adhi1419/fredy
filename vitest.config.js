/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Contract tests have their own config (vitest.contract.config.js) with a
    // setup file that redirects the DB to a temp dir. Running them without that
    // setup would write into the repo's real db/ directory.
    exclude: ['test/contract/**', '**/node_modules/**'],
    globalSetup: ['./test/globalSetup.js'],
    testTimeout: 60000,
    reporters: ['verbose'],
  },
});
