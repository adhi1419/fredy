/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract test harness.
 *
 * Boots the storage layer for the backend selected via STORAGE_BACKEND
 * (default: sqlite) and provides lifecycle helpers. Contract tests MUST NOT
 * contain any backend-specific code — no SQL, no Firestore refs. They seed and
 * assert exclusively through the public storage API, loaded via
 * loadStorageModule(). This harness is the only place that knows which backend
 * is running.
 *
 * Backends:
 *  - sqlite    : real better-sqlite3 DB in a temp dir, real production migrations.
 *  - firestore : Firestore emulator (FIRESTORE_EMULATOR_HOST, default 127.0.0.1:8144).
 *
 * NOTE ON ASYNC: the sqlite implementations are largely synchronous
 * (better-sqlite3), the firestore ones are inherently async. Contract tests
 * therefore `await` every storage call — awaiting a plain value is a no-op, so
 * the same test body is correct against both backends.
 */

const BACKEND = process.env.STORAGE_BACKEND ?? 'sqlite';

/** Modules that have a firestore implementation so far (Phase 1 rollout). */
const FIRESTORE_IMPLEMENTED = new Set(['settingsStorage', 'sessionStore']);

/**
 * Load a storage module for the active backend.
 * @param {string} name e.g. 'settingsStorage', 'jobStorage'
 */
export async function loadStorageModule(name) {
  if (BACKEND === 'firestore' && FIRESTORE_IMPLEMENTED.has(name)) {
    return import(`../../lib/services/storage/firestore/${name}.js`);
  }
  return import(`../../lib/services/storage/${name}.js`);
}

/**
 * Initialize the backend once per test file (call in beforeAll).
 */
export async function initBackend() {
  if (BACKEND === 'sqlite') {
    const { default: SqliteConnection } = await import('../../lib/services/storage/SqliteConnection.js');
    await SqliteConnection.init();
    const { runMigrations } = await import('../../lib/services/storage/migrations/migrate.js');
    await runMigrations();
    return;
  }
  if (BACKEND === 'firestore') {
    const { default: FirestoreConnection } =
      await import('../../lib/services/storage/firestore/FirestoreConnection.js');
    await FirestoreConnection.init();
    return;
  }
  throw new Error(`Unknown STORAGE_BACKEND: ${BACKEND}`);
}

/**
 * Wipe all data between tests (call in beforeEach) while keeping the schema.
 */
export async function resetBackend() {
  if (BACKEND === 'sqlite') {
    const { default: SqliteConnection } = await import('../../lib/services/storage/SqliteConnection.js');
    const db = SqliteConnection.getConnection();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
      )
      .all()
      .map((r) => r.name);
    db.pragma('foreign_keys = OFF');
    try {
      for (const t of tables) db.prepare(`DELETE FROM "${t}"`).run();
    } finally {
      db.pragma('foreign_keys = ON');
    }
    const settingsStorage = await import('../../lib/services/storage/settingsStorage.js');
    await settingsStorage.refreshSettingsCache();
    return;
  }
  if (BACKEND === 'firestore') {
    const { default: FirestoreConnection } =
      await import('../../lib/services/storage/firestore/FirestoreConnection.js');
    await FirestoreConnection.clearAllData();
    const settingsStorage = await loadStorageModule('settingsStorage');
    await settingsStorage.refreshSettingsCache();
    return;
  }
  throw new Error(`Unknown STORAGE_BACKEND: ${BACKEND}`);
}

/**
 * Close connections (call in afterAll).
 */
export async function teardownBackend() {
  if (BACKEND === 'sqlite') {
    const { default: SqliteConnection } = await import('../../lib/services/storage/SqliteConnection.js');
    SqliteConnection.close();
    return;
  }
  if (BACKEND === 'firestore') {
    const { default: FirestoreConnection } =
      await import('../../lib/services/storage/firestore/FirestoreConnection.js');
    await FirestoreConnection.close();
    return;
  }
}

export function backendName() {
  return BACKEND;
}
