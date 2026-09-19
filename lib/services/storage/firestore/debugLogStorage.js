/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * debugLogStorage — Firestore implementation.
 *
 * Same public API as the SQLite version in lib/services/debug/debugLogStorage.js.
 * All methods are async (the contract suite awaits every call).
 *
 * Data model: collection `debug_logs`
 *   doc id   : auto-generated (Firestore auto-id)
 *   fields   : { ts (number), level (string), message (string), byte_size (number),
 *               seq (number — monotonic insert counter for ordering) }
 *
 * A meta document `__meta__` in the same collection stores:
 *   { totalByteSize (number) }
 * This avoids running a SUM() aggregation on every insert.
 */

import FirestoreConnection from './FirestoreConnection.js';
import logger from '../../logger.js';

const COLLECTION = 'debug_logs';
const META_DOC_ID = '_meta_size_';

const SETTING_ENABLED = 'debug_logging_enabled';
const SETTING_EVER_ENABLED = 'debug_logging_ever_enabled';

/**
 * Hard cap on the total UTF-8 byte length of stored log MESSAGES (5 MiB).
 * @type {number}
 */
export const MAX_DEBUG_LOG_BYTES = 5 * 1024 * 1024;

/** Cached enabled flag — mirrors settings state. */
let cachedEnabled = null;
/** Cached total byte size — synced with the meta doc. */
let cachedSize = null;
/** Monotonic insert counter for ordering (Firestore has no autoincrement). */
let seqCounter = 0;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function col() {
  return FirestoreConnection.collection(COLLECTION);
}

function metaRef() {
  return col().doc(META_DOC_ID);
}

function byteLengthOf(str) {
  if (typeof str !== 'string') return 0;
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
    return Buffer.byteLength(str, 'utf-8');
  }
  return str.length;
}

async function loadSettingsModule() {
  // Dynamic import avoids circular dependency — settingsStorage is loaded
  // through the same Firestore backend at runtime.
  const mod = await import('./settingsStorage.js');
  return mod;
}

/**
 * Read the meta doc's totalByteSize, initializing it to 0 if absent.
 */
async function readMetaSize() {
  const snap = await metaRef().get();
  if (!snap.exists) return 0;
  return Number(snap.data()?.totalByteSize ?? 0);
}

/**
 * Write the meta doc's totalByteSize.
 */
async function writeMetaSize(size) {
  await metaRef().set({ totalByteSize: Math.max(0, size) });
}

/**
 * Initialize the seq counter from the highest existing seq value.
 */
async function initSeqCounter() {
  const snap = await col().where('seq', '>', 0).orderBy('seq', 'desc').limit(1).get();
  if (snap.empty) {
    seqCounter = 0;
  } else {
    seqCounter = Number(snap.docs[0].data()?.seq ?? 0);
  }
}

async function ensureCachesInitialized() {
  if (cachedEnabled == null) {
    const settings = await loadSettingsModule();
    const s = await settings.getSettings();
    cachedEnabled = s[SETTING_ENABLED] === true;
  }
  if (cachedSize == null) {
    cachedSize = await readMetaSize();
    await initSeqCounter();
  }
}

/**
 * Drop the oldest log documents until cachedSize <= MAX_DEBUG_LOG_BYTES.
 */
async function trimToFit() {
  if (cachedSize == null || cachedSize <= MAX_DEBUG_LOG_BYTES) return;

  while (cachedSize > MAX_DEBUG_LOG_BYTES) {
    // Fetch the 100 oldest non-meta docs.
    const snap = await col().where('seq', '>', 0).orderBy('seq', 'asc').limit(100).get();
    if (snap.empty) {
      // Nothing left to trim — resync.
      cachedSize = 0;
      await writeMetaSize(0);
      break;
    }

    const needToFree = cachedSize - MAX_DEBUG_LOG_BYTES;
    let freed = 0;
    const toDelete = [];
    for (const doc of snap.docs) {
      toDelete.push(doc);
      freed += Number(doc.data()?.byte_size ?? 0);
      if (freed >= needToFree) break;
    }

    const db = FirestoreConnection.getConnection();
    const batch = db.batch();
    for (const doc of toDelete) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    cachedSize -= freed;

    if (freed === 0) {
      // All deleted rows had byte_size 0 — resync to prevent infinite loop.
      cachedSize = await recomputeSize();
      await writeMetaSize(cachedSize);
      break;
    }
  }

  if (cachedSize < 0) cachedSize = 0;
  await writeMetaSize(cachedSize);
}

/**
 * Recompute size from all documents (fallback for drift).
 */
async function recomputeSize() {
  const snap = await col().where('seq', '>', 0).get();
  let total = 0;
  for (const doc of snap.docs) {
    total += Number(doc.data()?.byte_size ?? 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isEnabled() {
  return cachedEnabled === true;
}

export async function appendLogEntry(entry) {
  if (!isEnabled()) return;
  if (!entry || typeof entry.message !== 'string') return;

  try {
    await ensureCachesInitialized();

    const ts = Number.isFinite(entry.ts) ? entry.ts : Date.now();
    const level = String(entry.level || 'info');
    const message = entry.message;
    const byte_size = byteLengthOf(message);

    seqCounter += 1;
    await col().add({ ts, level, message, byte_size, seq: seqCounter });

    cachedSize = (cachedSize ?? 0) + byte_size;
    await writeMetaSize(cachedSize);
    await trimToFit();
  } catch (e) {
    // Logging must never break the application.
    logger.debug('debugLogStorage.appendLogEntry failed:', e?.message);
  }
}

export async function clearAllDebugLogs() {
  const snap = await col().get();
  if (!snap.empty) {
    const db = FirestoreConnection.getConnection();
    // Batch delete in chunks of 500.
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 500) {
      const batch = db.batch();
      for (const doc of docs.slice(i, i + 500)) {
        batch.delete(doc.ref);
      }
      await batch.commit();
    }
  }
  cachedSize = 0;
  seqCounter = 0;
  // Re-create the meta doc at 0.
  await writeMetaSize(0);
}

export async function getCurrentSize() {
  await ensureCachesInitialized();
  return cachedSize ?? 0;
}

export function getMaxSize() {
  return MAX_DEBUG_LOG_BYTES;
}

export async function hasAnyLogs() {
  // Use a where clause to exclude the meta doc — orderBy('seq') alone doesn't
  // guarantee exclusion on the emulator if the meta doc has no seq field.
  const snap = await col().where('seq', '>', 0).limit(1).get();
  return !snap.empty;
}

export async function wasEverEnabled() {
  const settings = await loadSettingsModule();
  const s = await settings.getSettings();
  return s[SETTING_EVER_ENABLED] === true;
}

export async function enableDebugLogging({ clearPrevious = false } = {}) {
  if (clearPrevious) {
    await clearAllDebugLogs();
  }
  const settings = await loadSettingsModule();
  await settings.upsertSettings({ [SETTING_ENABLED]: true, [SETTING_EVER_ENABLED]: true });
  cachedEnabled = true;
  if (cachedSize == null) {
    cachedSize = await readMetaSize();
  }
  // Attach logger sink.
  logger.setDebugLogSink((entry) => appendLogEntry(entry));
}

export async function disableDebugLogging() {
  const settings = await loadSettingsModule();
  await settings.upsertSettings({ [SETTING_ENABLED]: false });
  cachedEnabled = false;
  logger.setDebugLogSink(null);
}

export function getAllDebugLogs() {
  return col()
    .where('seq', '>', 0)
    .orderBy('seq', 'asc')
    .get()
    .then((snap) =>
      snap.docs.map((d) => {
        const data = d.data();
        return { id: d.id, ts: data.ts, level: data.level, message: data.message };
      }),
    );
}

export async function reloadEnabledFromSettings() {
  const settings = await loadSettingsModule();
  const s = await settings.getSettings();
  cachedEnabled = s[SETTING_ENABLED] === true;
  if (cachedEnabled) {
    logger.setDebugLogSink((entry) => appendLogEntry(entry));
  } else {
    logger.setDebugLogSink(null);
  }
  return cachedEnabled;
}

export function _resetForTests() {
  cachedSize = null;
  cachedEnabled = null;
  seqCounter = 0;
}
