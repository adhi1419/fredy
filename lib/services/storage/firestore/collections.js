/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Shared helpers for the Firestore storage implementations.
 */

import crypto from 'crypto';
import FirestoreConnection from './FirestoreConnection.js';

export const COLLECTIONS = Object.freeze({
  SETTINGS: 'settings',
  SESSIONS: 'sessions',
  USERS: 'users',
  JOBS: 'jobs',
  CHANNELS: 'configured_adapters',
  LISTINGS: 'listings',
  WATCH_LIST: 'watch_list',
});

export const BATCH_LIMIT = 500;

/** Deterministic listing document id — replaces UNIQUE(job_id, hash). */
export function listingDocId(jobId, hash) {
  return crypto.createHash('sha1').update(`${jobId}\0${hash}`).digest('hex');
}

/** Watch list document id — replaces UNIQUE(listing_id, user_id). */
export function watchDocId(listingId, userId) {
  return `${listingId}__${userId}`;
}

/**
 * Run an operation for every item, committing in batches of <= 500 writes.
 * @param {Array<any>} items
 * @param {(batch: FirebaseFirestore.WriteBatch, item: any) => void} op
 */
export async function batched(items, op) {
  const db = FirestoreConnection.getConnection();
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const item of items.slice(i, i + BATCH_LIMIT)) {
      op(batch, item);
    }
    await batch.commit();
  }
}

/**
 * Fetch documents by id in chunks (no IN-query limits apply to getAll).
 * Returns only existing docs.
 */
export async function getDocsByIds(collectionName, ids) {
  if (!ids?.length) return [];
  const db = FirestoreConnection.getConnection();
  const col = db.collection(collectionName);
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const refs = ids.slice(i, i + BATCH_LIMIT).map((id) => col.doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.push(snap);
    }
  }
  return out;
}

/**
 * Mirror of SQLite column affinity for NUMERIC/INTEGER columns: a value that
 * looks like a number is stored as one; everything else is kept verbatim.
 */
export function numericAffinity(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

/** In-memory pagination helper matching the sqlite layer's LIMIT/OFFSET math. */
export function paginate(rows, page, pageSize, { maxPageSize = 1000, defaultPageSize = 50 } = {}) {
  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0 ? Math.min(maxPageSize, Math.floor(pageSize)) : defaultPageSize;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const offset = (safePage - 1) * safePageSize;
  return { pageRows: rows.slice(offset, offset + safePageSize), safePage, safePageSize };
}
