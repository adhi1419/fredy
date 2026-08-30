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
 * assert exclusively through the public storage API. This harness is the only
 * place that knows which backend is running.
 *
 * Backends:
 *  - sqlite    : real better-sqlite3 DB in a temp dir, real production migrations.
 *  - firestore : (Phase 2+) Firestore emulator-backed implementation.
 */

const BACKEND = process.env.STORAGE_BACKEND ?? 'sqlite';

/**
 * Initialize the backend once per test file (call in beforeAll).
 * Runs the real production migrations so the schema is exactly what ships.
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
    // Phase 2: boot Firestore emulator-backed connection here.
    throw new Error('firestore backend not implemented yet');
  }
  throw new Error(`Unknown STORAGE_BACKEND: ${BACKEND}`);
}

/**
 * Wipe all data between tests (call in beforeEach/afterEach) while keeping the
 * schema. Order-independent: disables FK enforcement during the wipe.
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
    // The settings module caches compiled settings in module scope; a data
    // wipe must invalidate it the same way production writes do.
    const settingsStorage = await import('../../lib/services/storage/settingsStorage.js');
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
}

export function backendName() {
  return BACKEND;
}
