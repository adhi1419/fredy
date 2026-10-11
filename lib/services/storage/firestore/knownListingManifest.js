/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'node:crypto';
import FirestoreConnection from './FirestoreConnection.js';

/** Dedicated internal collection for the exact known-listing index. */
export const KNOWN_LISTING_MANIFEST_COLLECTION = '_known_listing_manifests';

/** A fixed shard count keeps cold-start reads independent of the listing count. */
export const MANIFEST_SHARD_COUNT = 16;

const manifestCol = () => FirestoreConnection.collection(KNOWN_LISTING_MANIFEST_COLLECTION);

/**
 * Pick the stable manifest shard for a listing document id.
 *
 * The listing id is already a deterministic hash of job id and provider hash. Hashing it once more
 * spreads ids evenly without exposing a provider hash as a Firestore document path.
 *
 * @param {string} listingId
 * @returns {string} One hexadecimal shard key from 0 through f.
 */
export function manifestShardForListingId(listingId) {
  return crypto.createHash('sha256').update(String(listingId)).digest('hex')[0];
}

/**
 * Return the document id for a manifest shard.
 *
 * @param {string} shard
 * @returns {string}
 */
export function manifestDocId(shard) {
  return `shard-${shard}`;
}

function validIds(ids) {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
}

function groupedByShard(ids) {
  const groups = new Map();
  for (const id of validIds(ids)) {
    const shard = manifestShardForListingId(id);
    const group = groups.get(shard) ?? [];
    group.push(id);
    groups.set(shard, group);
  }
  return groups;
}

/**
 * Load all persisted exact identities.
 *
 * An empty collection means this installation predates migration 010. Callers may use the legacy
 * one-time listing scan in that case; once any manifest exists, the manifest is authoritative.
 *
 * @returns {Promise<{loaded: boolean, ids: string[]}>}
 */
export async function loadKnownListingManifest() {
  const snapshot = await manifestCol().get();
  if (snapshot.docs.length === 0) return { loaded: false, ids: [] };

  const ids = new Set();
  for (const doc of snapshot.docs) {
    for (const id of doc.data()?.knownListingIds ?? []) {
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return { loaded: true, ids: [...ids] };
}

/**
 * Add listing identities, grouped into one read-modify-write per affected shard.
 *
 * @param {string[]} ids Listing document ids to retain as known.
 * @returns {Promise<void>}
 */
export async function addKnownListingIdsToManifest(ids) {
  const groups = groupedByShard(ids);
  if (groups.size === 0) return;

  const db = FirestoreConnection.getConnection();
  const current = new Map(
    await Promise.all(
      [...groups.keys()].map(async (shard) => [shard, await manifestCol().doc(manifestDocId(shard)).get()]),
    ),
  );
  const batch = db.batch();
  let writes = 0;
  for (const [shard, additions] of groups) {
    const snap = current.get(shard);
    const existing = validIds(snap?.data()?.knownListingIds);
    const next = [...new Set([...existing, ...additions])].sort();
    if (JSON.stringify(existing.sort()) === JSON.stringify(next)) continue;
    batch.set(manifestCol().doc(manifestDocId(shard)), { knownListingIds: next }, { merge: true });
    writes++;
  }
  if (writes > 0) await batch.commit();
}

/**
 * Remove listing identities from the persisted manifest after a hard delete.
 *
 * @param {string[]} ids Listing document ids to forget.
 * @returns {Promise<void>}
 */
export async function removeKnownListingIdsFromManifest(ids) {
  const groups = groupedByShard(ids);
  if (groups.size === 0) return;

  const db = FirestoreConnection.getConnection();
  const current = new Map(
    await Promise.all(
      [...groups.keys()].map(async (shard) => [shard, await manifestCol().doc(manifestDocId(shard)).get()]),
    ),
  );
  const batch = db.batch();
  let writes = 0;
  for (const [shard, removals] of groups) {
    const snap = current.get(shard);
    if (!snap?.exists) continue;
    const remove = new Set(removals);
    const existing = validIds(snap.data()?.knownListingIds);
    const next = existing.filter((id) => !remove.has(id));
    if (next.length === existing.length) continue;
    batch.set(manifestCol().doc(manifestDocId(shard)), { knownListingIds: next }, { merge: true });
    writes++;
  }
  if (writes > 0) await batch.commit();
}
