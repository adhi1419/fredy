/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * FirestoreConnection
 *
 * Singleton holding the Firestore client. In local tests and development it
 * targets the emulator via FIRESTORE_EMULATOR_HOST (the official client picks
 * that env var up natively). In production on Cloud Run it uses Application
 * Default Credentials and the project the service runs in (or
 * FIRESTORE_PROJECT_ID when set).
 */

import { Firestore } from '@google-cloud/firestore';
import logger from '../../logger.js';
import { recordFirestoreRead, recordFirestoreWrite } from './firestoreUsage.js';

const wrappedCollections = new WeakMap();
const wrappedQueries = new WeakMap();
const wrappedDocuments = new WeakMap();

function readCount(snapshot, fallback = 1) {
  return Number.isFinite(snapshot?.size) ? snapshot.size : fallback;
}

function wrapQuery(query) {
  if (query == null || typeof query !== 'object') return query;
  if (wrappedQueries.has(query)) return wrappedQueries.get(query);
  const wrapped = new Proxy(query, {
    get(target, property) {
      const value = target[property];
      if (property === 'get' && typeof value === 'function') {
        return async (...args) => {
          const snapshot = await Reflect.apply(value, target, args);
          recordFirestoreRead(readCount(snapshot));
          return snapshot;
        };
      }
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        return result && typeof result === 'object' && typeof result.get === 'function' ? wrapQuery(result) : result;
      };
    },
  });
  wrappedQueries.set(query, wrapped);
  return wrapped;
}

function wrapDocument(document) {
  if (document == null || typeof document !== 'object') return document;
  if (wrappedDocuments.has(document)) return wrappedDocuments.get(document);
  const wrapped = new Proxy(document, {
    get(target, property) {
      const value = target[property];
      if (property === 'get' && typeof value === 'function') {
        return async (...args) => {
          const snapshot = await Reflect.apply(value, target, args);
          recordFirestoreRead(1);
          return snapshot;
        };
      }
      if (['create', 'set', 'update', 'delete'].includes(property) && typeof value === 'function') {
        return async (...args) => {
          const result = await Reflect.apply(value, target, args);
          recordFirestoreWrite(1);
          return result;
        };
      }
      if (property === 'collection' && typeof value === 'function') {
        return (...args) => wrapCollection(Reflect.apply(value, target, args));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  wrappedDocuments.set(document, wrapped);
  return wrapped;
}

function wrapCollection(collection) {
  if (collection == null || typeof collection !== 'object') return collection;
  if (wrappedCollections.has(collection)) return wrappedCollections.get(collection);
  const wrapped = new Proxy(collection, {
    get(target, property) {
      const value = target[property];
      if (property === 'get' && typeof value === 'function') {
        return async (...args) => {
          const snapshot = await Reflect.apply(value, target, args);
          recordFirestoreRead(readCount(snapshot));
          return snapshot;
        };
      }
      if (property === 'doc' && typeof value === 'function') {
        return (...args) => wrapDocument(Reflect.apply(value, target, args));
      }
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        if (result && typeof result === 'object') {
          if (typeof result.get === 'function') return wrapQuery(result);
          if (typeof result.create === 'function' && typeof result.update === 'function') return wrapDocument(result);
        }
        return result;
      };
    },
  });
  wrappedCollections.set(collection, wrapped);
  return wrapped;
}

function wrapBatch(batch) {
  return new Proxy(batch, {
    get(target, property) {
      const value = target[property];
      if (['create', 'set', 'update', 'delete'].includes(property) && typeof value === 'function') {
        return (...args) => {
          recordFirestoreWrite(1);
          return Reflect.apply(value, target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapTransaction(transaction) {
  return new Proxy(transaction, {
    get(target, property) {
      const value = target[property];
      if (property === 'get' && typeof value === 'function') {
        return async (...args) => {
          const snapshot = await Reflect.apply(value, target, args);
          recordFirestoreRead(1);
          return snapshot;
        };
      }
      if (property === 'getAll' && typeof value === 'function') {
        return async (...args) => {
          const snapshots = await Reflect.apply(value, target, args);
          recordFirestoreRead(snapshots?.length ?? 0);
          return snapshots;
        };
      }
      if (['create', 'set', 'update', 'delete'].includes(property) && typeof value === 'function') {
        return (...args) => {
          recordFirestoreWrite(1);
          return Reflect.apply(value, target, args);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapConnection(db) {
  return new Proxy(db, {
    get(target, property) {
      const value = target[property];
      if (property === 'collection' && typeof value === 'function') {
        return (...args) => wrapCollection(Reflect.apply(value, target, args));
      }
      if (property === 'doc' && typeof value === 'function') {
        return (...args) => wrapDocument(Reflect.apply(value, target, args));
      }
      if (property === 'getAll' && typeof value === 'function') {
        return async (...args) => {
          const snapshots = await Reflect.apply(value, target, args);
          recordFirestoreRead(snapshots?.length ?? 0);
          return snapshots;
        };
      }
      if (property === 'batch' && typeof value === 'function') {
        return (...args) => wrapBatch(Reflect.apply(value, target, args));
      }
      if (property === 'runTransaction' && typeof value === 'function') {
        return (updateFunction, ...args) =>
          Reflect.apply(value, target, [async (transaction) => updateFunction(wrapTransaction(transaction)), ...args]);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

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
    return wrapConnection(this.#db);
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
