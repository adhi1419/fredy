/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { listingDocId } from './collections.js';

/**
 * In-memory index of every stored listing document id, soft-deleted tombstones included.
 *
 * It answers the pipeline's "is this scraped listing already stored?" question without a Firestore
 * read per known listing. A listing document id is deterministic (`listingDocId(jobId, hash)`), so
 * the index is a plain set of ids.
 *
 * The index is only trusted when it says YES. A stored listing never becomes new again, so a hit is
 * always correct; a miss may be stale (another instance stored it, or the index was loaded before
 * the write) and must be confirmed against Firestore. That makes staleness cost a read, never a
 * duplicate notification.
 *
 * It is loaded once per process by the similarity cache's first full read, grows on every
 * `storeListings` and every miss Firestore confirms, and shrinks on every hard delete, so a purged
 * listing that reappears is seen as new straight away - exactly as it is without the index.
 *
 * Deliberately free of storage imports: storage modules call into it, and an import back would
 * close a cycle.
 */

/** @type {Set<string>} */
let knownIds = new Set();
let loaded = false;

/**
 * Replace the whole index with a fresh full read.
 *
 * @param {Iterable<string>} ids Every stored listing document id.
 * @returns {void}
 */
export function replaceKnownListingIds(ids) {
  knownIds = new Set(ids);
  loaded = true;
}

/**
 * Record listing document ids that now exist in Firestore.
 *
 * @param {Iterable<string>} ids
 * @returns {void}
 */
export function addKnownListingIds(ids) {
  for (const id of ids ?? []) {
    if (typeof id === 'string' && id.length > 0) knownIds.add(id);
  }
}

/**
 * Forget hard-deleted listing document ids.
 *
 * @param {Iterable<string>} ids
 * @returns {void}
 */
export function forgetKnownListingIds(ids) {
  for (const id of ids ?? []) knownIds.delete(id);
}

/**
 * Whether a full load has happened since start-up or the last reset.
 *
 * @returns {boolean}
 */
export function isKnownListingIndexLoaded() {
  return loaded;
}

/**
 * Drop everything and stop answering until the next full reload, e.g. after a wipe or a restore
 * rewrote the collection underneath the index.
 *
 * @returns {void}
 */
export function resetKnownListingIndex() {
  knownIds = new Set();
  loaded = false;
}

/**
 * Split candidate provider hashes into those the index knows and those still to confirm.
 *
 * Before the first full load every hash is reported as unconfirmed, so the caller falls back to
 * Firestore for all of them.
 *
 * @param {string} jobId
 * @param {string[]} hashes Provider listing hashes from a scrape.
 * @returns {{ known: string[], unconfirmed: string[] }}
 */
export function partitionKnownHashes(jobId, hashes) {
  const known = [];
  const unconfirmed = [];
  for (const hash of hashes ?? []) {
    if (typeof hash !== 'string' || hash.length === 0) continue;
    if (loaded && knownIds.has(listingDocId(jobId, hash))) known.push(hash);
    else unconfirmed.push(hash);
  }
  return { known, unconfirmed };
}
