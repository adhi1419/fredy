/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract test setup (vitest setupFile).
 *
 * Injects a per-worker temporary database directory by partially mocking
 * readConfigFromStorage. Everything else in lib/utils.js stays real.
 *
 * IMPORTANT: SqliteConnection.getConnection() strips a leading '/' from
 * sqlitepath and resolves it relative to process.cwd(). To land the DB in a
 * real OS temp dir we pass a *relative* path from cwd to the temp dir.
 */
import { vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpAbs = fs.mkdtempSync(path.join(os.tmpdir(), 'fredy-contract-'));
const tmpRel = path.relative(process.cwd(), tmpAbs);

// Expose for harness teardown.
globalThis.__CONTRACT_DB_DIR__ = { abs: tmpAbs, rel: tmpRel };

vi.mock('../../lib/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readConfigFromStorage: async () => ({
      sqlitepath: globalThis.__CONTRACT_DB_DIR__.rel,
      interval: 60,
      port: 9998,
    }),
  };
});
