/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * FirestoreConnection
 *
 * Firestore counterpart of SqliteConnection: a singleton holding the Firestore
 * client. In tests/dev it targets the emulator via FIRESTORE_EMULATOR_HOST
 * (the official client picks that env var up natively). In production on
 * Cloud Run it uses Application Default Credentials and the project the
 * service runs in (or FIRESTORE_PROJECT_ID when set).
 */

import { Firestore } from '@google-cloud/firestore';
import logger from '../../logger.js';

class FirestoreConnection {
  static #db = null;
  static #projectId = null;

  static async init() {
    if (this.#db) return;
    this.#projectId =
      process.env.FIRESTORE_PROJECT_ID ??
      (process.env.FIRESTORE_EMULATOR_HOST ? `fredy-test-${process.pid}` : undefined);
    this.#db = new Firestore({
      ...(this.#projectId ? { projectId: this.#projectId } : {}),
      // The emulator does not require credentials; the client skips auth when
      // FIRESTORE_EMULATOR_HOST is set.
    });
  }

  /** @returns {Firestore} */
  static getConnection() {
    if (!this.#db) {
      throw new Error('FirestoreConnection not initialized. Call init() first.');
    }
    return this.#db;
  }

  static collection(name) {
    return this.getConnection().collection(name);
  }

  /**
   * TEST ONLY: wipe every document via the emulator's purge endpoint.
   * Refuses to run against a real Firestore.
   */
  static async clearAllData() {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host) {
      throw new Error('clearAllData() is emulator-only. FIRESTORE_EMULATOR_HOST is not set.');
    }
    const url = `http://${host}/emulator/v1/projects/${this.#projectId}/databases/(default)/documents`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      throw new Error(`Emulator purge failed: ${res.status} ${await res.text()}`);
    }
  }

  static async close() {
    if (this.#db) {
      try {
        await this.#db.terminate();
      } catch (e) {
        logger.debug('Firestore terminate failed:', e?.message);
      }
      this.#db = null;
    }
  }
}

export default FirestoreConnection;
