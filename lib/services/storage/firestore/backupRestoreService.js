/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * backupRestoreService — Firestore implementation.
 *
 * Same public API as the SQLite version (createBackupZip, precheckRestore,
 * restoreFromZip, buildBackupFileName), redesigned for Firestore:
 *
 * Backup format: a zip containing one JSON file per top-level collection
 * (users.json, jobs.json, listings.json, …) plus subcollection files
 * (travel_times.json, price_history.json keyed by parent listing id) and a
 * manifest.json with { format, createdAt, fredyVersion }.
 *
 * Restore: wipes current data (emulator purge or batched deletes), then
 * re-imports every document from the JSON files.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS, batched } from './collections.js';
import { getPackageVersion } from '../../../utils.js';
import logger from '../../logger.js';

const FORMAT_VERSION = 'firestore-json-v1';

// ── AdmZip lazy loader (mirrors the sqlite version) ─────────────────────

let _AdmZipSingleton = null;
async function getAdmZip() {
  if (_AdmZipSingleton) return _AdmZipSingleton;
  if (globalThis && globalThis.__TEST_ADM_ZIP__) {
    _AdmZipSingleton = globalThis.__TEST_ADM_ZIP__;
    return _AdmZipSingleton;
  }
  const mod = await import('adm-zip');
  _AdmZipSingleton = (mod && mod.default) || mod;
  return _AdmZipSingleton;
}

// ── Internal helpers ────────────────────────────────────────────────────

const db = () => FirestoreConnection.getConnection();

/** Dump every document from a top-level collection as an array of { id, ...data }. */
async function dumpCollection(name) {
  const snapshot = await db().collection(name).get();
  return snapshot.docs.map((doc) => ({ _docId: doc.id, ...doc.data() }));
}

/** Dump all subcollection docs for every listing that has them. */
async function dumpListingSubcollections() {
  const listingsSnap = await db().collection(COLLECTIONS.LISTINGS).get();
  const travelTimes = [];
  const priceHistory = [];

  for (const listingDoc of listingsSnap.docs) {
    const ttSnap = await listingDoc.ref.collection('travel_times').get();
    for (const ttDoc of ttSnap.docs) {
      travelTimes.push({ _parentId: listingDoc.id, _docId: ttDoc.id, ...ttDoc.data() });
    }

    const phSnap = await listingDoc.ref.collection('price_history').get();
    for (const phDoc of phSnap.docs) {
      priceHistory.push({ _parentId: listingDoc.id, _docId: phDoc.id, ...phDoc.data() });
    }
  }

  return { travelTimes, priceHistory };
}

/** Delete every document in a collection (batched). */
async function deleteCollection(name) {
  const snapshot = await db().collection(name).get();
  if (snapshot.empty) return;
  await batched(snapshot.docs, (batch, doc) => batch.delete(doc.ref));
}

/** Delete all listings including their subcollections. */
async function deleteListingsWithSubcollections() {
  const snapshot = await db().collection(COLLECTIONS.LISTINGS).get();
  for (const doc of snapshot.docs) {
    // recursiveDelete handles subcollections (travel_times, price_history)
    await db().recursiveDelete(doc.ref);
  }
}

/** Wipe all Firestore data. Uses emulator purge when available, batched deletes otherwise. */
async function wipeAllData() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    await FirestoreConnection.clearAllData();
    return;
  }
  // Production path: delete collection by collection.
  await deleteListingsWithSubcollections();
  for (const col of Object.values(COLLECTIONS)) {
    if (col !== COLLECTIONS.LISTINGS) {
      await deleteCollection(col);
    }
  }
}

/** Import an array of { _docId, ...data } into a collection. */
async function importCollection(name, docs) {
  if (!Array.isArray(docs) || docs.length === 0) return;
  const col = db().collection(name);
  await batched(docs, (batch, doc) => {
    const { _docId, ...data } = doc;
    batch.set(col.doc(_docId), data);
  });
}

/** Import subcollection docs into their parent listing's subcollection. */
async function importSubcollection(subName, docs) {
  if (!Array.isArray(docs) || docs.length === 0) return;
  const listingsRef = db().collection(COLLECTIONS.LISTINGS);
  await batched(docs, (batch, doc) => {
    const { _parentId, _docId, ...data } = doc;
    const subRef = listingsRef.doc(_parentId).collection(subName).doc(_docId);
    batch.set(subRef, data);
  });
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Create a backup zip buffer containing all Firestore data as JSON.
 * @returns {Promise<Buffer>}
 */
export async function createBackupZip() {
  const AdmZip = await getAdmZip();
  const zip = new AdmZip();

  // Dump every top-level collection
  for (const colName of Object.values(COLLECTIONS)) {
    const docs = await dumpCollection(colName);
    zip.addFile(`${colName}.json`, Buffer.from(JSON.stringify(docs, null, 2), 'utf-8'));
  }

  // Dump listing subcollections
  const { travelTimes, priceHistory } = await dumpListingSubcollections();
  zip.addFile('travel_times.json', Buffer.from(JSON.stringify(travelTimes, null, 2), 'utf-8'));
  zip.addFile('price_history.json', Buffer.from(JSON.stringify(priceHistory, null, 2), 'utf-8'));

  // Manifest
  const manifest = {
    format: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    fredyVersion: await getPackageVersion(),
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'));

  return zip.toBuffer();
}

/**
 * Validate a backup zip for compatibility.
 * @param {Buffer} zipBuffer
 * @returns {Promise<{compatible:boolean, severity:string, message:string, fredyVersion:string|null}>}
 */
export async function precheckRestore(zipBuffer) {
  if (!zipBuffer || zipBuffer.length === 0) {
    return {
      compatible: false,
      severity: 'danger',
      message: 'Empty upload',
      fredyVersion: null,
    };
  }

  let manifest;
  try {
    const AdmZip = await getAdmZip();
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntry('manifest.json');
    if (!entry) {
      return {
        compatible: false,
        severity: 'danger',
        message: 'Zip is missing manifest.json. This does not look like a Firestore backup.',
        fredyVersion: null,
      };
    }
    manifest = JSON.parse(entry.getData().toString('utf-8'));
  } catch {
    return {
      compatible: false,
      severity: 'danger',
      message: 'Failed to read or parse manifest.json from the backup zip.',
      fredyVersion: null,
    };
  }

  if (manifest.format !== FORMAT_VERSION) {
    return {
      compatible: false,
      severity: 'danger',
      message: `Unsupported backup format "${manifest.format}". Expected "${FORMAT_VERSION}".`,
      fredyVersion: manifest.fredyVersion ?? null,
    };
  }

  // Check that at least one data file is present
  try {
    const AdmZip = await getAdmZip();
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().map((e) => e.entryName);
    const hasData = Object.values(COLLECTIONS).some((col) => entries.includes(`${col}.json`));
    if (!hasData) {
      return {
        compatible: true,
        severity: 'warning',
        message: 'Backup appears to contain no collection data files. Restore will wipe current data.',
        fredyVersion: manifest.fredyVersion ?? null,
      };
    }
  } catch {
    // Non-fatal — if we got this far the zip is valid
  }

  return {
    compatible: true,
    severity: 'info',
    message: 'Backup is compatible with the current Firestore backend.',
    fredyVersion: manifest.fredyVersion ?? null,
  };
}

/**
 * Restore data from a backup zip. Wipes current data first.
 * @param {Buffer} zipBuffer
 * @param {{force?:boolean}} [opts]
 * @returns {Promise<{restored:true, warning:string|null, details:any}>}
 */
export async function restoreFromZip(zipBuffer, { force = false } = {}) {
  const check = await precheckRestore(zipBuffer);
  if (!check.compatible && !force) {
    const err = new Error(check.message || 'Backup is incompatible');
    err.code = 'INCOMPATIBLE';
    err.payload = check;
    throw err;
  }

  const AdmZip = await getAdmZip();
  const zip = new AdmZip(zipBuffer);

  // Wipe everything
  await wipeAllData();

  // Import top-level collections
  for (const colName of Object.values(COLLECTIONS)) {
    const entry = zip.getEntry(`${colName}.json`);
    if (!entry) continue;
    try {
      const docs = JSON.parse(entry.getData().toString('utf-8'));
      await importCollection(colName, docs);
    } catch (e) {
      logger.warn(`Failed to import collection ${colName}:`, e.message);
    }
  }

  // Import subcollections
  const ttEntry = zip.getEntry('travel_times.json');
  if (ttEntry) {
    try {
      const docs = JSON.parse(ttEntry.getData().toString('utf-8'));
      await importSubcollection('travel_times', docs);
    } catch (e) {
      logger.warn('Failed to import travel_times:', e.message);
    }
  }

  const phEntry = zip.getEntry('price_history.json');
  if (phEntry) {
    try {
      const docs = JSON.parse(phEntry.getData().toString('utf-8'));
      await importSubcollection('price_history', docs);
    } catch (e) {
      logger.warn('Failed to import price_history:', e.message);
    }
  }

  // Refresh settings cache after restore
  try {
    const { refreshSettingsCache } = await import('./settingsStorage.js');
    await refreshSettingsCache();
  } catch (e) {
    logger.warn('Failed to refresh settings cache after restore:', e.message);
  }

  return {
    restored: true,
    warning: check.severity !== 'info' ? check.message : null,
    details: check,
  };
}

/**
 * Build the backup file name with current date and Fredy version.
 * @returns {Promise<string>}
 */
export async function buildBackupFileName() {
  const dt = new Date();
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const version = await getPackageVersion();
  return `${yyyy}-${mm}-${dd}-FredyBackup-${version}.zip`.replaceAll(' ', '');
}
