/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Firestore storage contract harness.
 *
 * Contract tests run against the local Firestore emulator and import the concrete production
 * implementations. Every call remains awaited because Firestore operations are asynchronous.
 */

/**
 * Load a Firestore storage module.
 * @param {string} name e.g. 'settingsStorage', 'jobStorage'
 */
export async function loadStorageModule(name) {
  return import(`../../lib/services/storage/firestore/${name}.js`);
}

/** Initialize Firestore once per test file. */
export async function initBackend() {
  const { default: FirestoreConnection } = await import('../../lib/services/storage/firestore/FirestoreConnection.js');
  await FirestoreConnection.init();
}

/** Wipe all emulator data between tests. */
export async function resetBackend() {
  const { default: FirestoreConnection } = await import('../../lib/services/storage/firestore/FirestoreConnection.js');
  await FirestoreConnection.clearAllData();
  const settingsStorage = await loadStorageModule('settingsStorage');
  await settingsStorage.refreshSettingsCache();
}

/** Close the Firestore connection after each contract file. */
export async function teardownBackend() {
  const { default: FirestoreConnection } = await import('../../lib/services/storage/firestore/FirestoreConnection.js');
  await FirestoreConnection.close();
}
