/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'node:crypto';
import { FieldValue } from '@google-cloud/firestore';
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

/** The sixteen shard keys, `0` to `f`. */
const EXPECTED_SHARDS = Object.freeze([...Array(MANIFEST_SHARD_COUNT)].map((_, index) => index.toString(16)));

/**
 * Create all shards, empty, for an instance that has never stored a listing.
 *
 * Every shard is created in one batch with `create`, so two cold instances racing on first boot
 * cannot both succeed: the loser gets ALREADY_EXISTS and re-reads what the winner wrote.
 */
async function createEmptyManifest() {
  const db = FirestoreConnection.getConnection();
  const batch = db.batch();
  for (const shard of EXPECTED_SHARDS) {
    batch.create(manifestCol().doc(manifestDocId(shard)), { shard, knownListingIds: [] });
  }
  try {
    await batch.commit();
  } catch (error) {
    if (error?.code !== 6 /* ALREADY_EXISTS */) throw error;
  }
}

/**
 * Load all persisted exact identities.
 *
 * Three states are told apart. A complete manifest is read as is. No manifest at all on an
 * instance with no listings is a fresh deployment: the shards are created empty and startup goes
 * on, so a new instance needs no migration. Anything else - shards missing while listings exist,
 * or a shard without its array - is a data-integrity failure and stops startup rather than
 * scanning the listings collection to rebuild (migration 010 does that deliberately).
 *
 * @returns {Promise<{loaded: boolean, ids: string[]}>}
 */
export async function loadKnownListingManifest() {
  let snapshot = await manifestCol().get();
  if (snapshot.empty) {
    const anyListing = await FirestoreConnection.collection('listings').limit(1).get();
    if (!anyListing.empty) {
      throw new Error(
        'Known-listing manifest is missing but listings exist; run migration 010-known-listing-manifests',
      );
    }
    await createEmptyManifest();
    snapshot = await manifestCol().get();
  }

  const docsById = new Map(snapshot.docs.map((doc) => [doc.id, doc]));
  if (EXPECTED_SHARDS.some((shard) => !docsById.has(manifestDocId(shard)))) {
    throw new Error(`Known-listing manifest is incomplete; expected all ${MANIFEST_SHARD_COUNT} shards`);
  }

  const ids = new Set();
  for (const shard of EXPECTED_SHARDS) {
    const values = docsById.get(manifestDocId(shard)).data()?.knownListingIds;
    if (!Array.isArray(values)) {
      throw new Error(`Known-listing manifest shard ${shard} has no valid knownListingIds array`);
    }
    for (const id of values) {
      if (typeof id === 'string' && id.length > 0) ids.add(id);
    }
  }
  return { loaded: true, ids: [...ids] };
}

/**
 * Add listing identities with one atomic transform write per affected shard.
 *
 * @param {string[]} ids Listing document ids to retain as known.
 * @returns {Promise<void>}
 */
export async function addKnownListingIdsToManifest(ids) {
  const groups = groupedByShard(ids);
  if (groups.size === 0) return;

  const db = FirestoreConnection.getConnection();
  const batch = db.batch();
  for (const [shard, additions] of groups) {
    batch.set(
      manifestCol().doc(manifestDocId(shard)),
      { knownListingIds: FieldValue.arrayUnion(...additions) },
      { merge: true },
    );
  }
  await batch.commit();
}

/**
 * Remove listing identities with one atomic transform write per affected shard.
 *
 * @param {string[]} ids Listing document ids to forget.
 * @returns {Promise<void>}
 */
export async function removeKnownListingIdsFromManifest(ids) {
  const groups = groupedByShard(ids);
  if (groups.size === 0) return;

  const db = FirestoreConnection.getConnection();
  const batch = db.batch();
  for (const [shard, removals] of groups) {
    batch.set(
      manifestCol().doc(manifestDocId(shard)),
      { knownListingIds: FieldValue.arrayRemove(...removals) },
      { merge: true },
    );
  }
  await batch.commit();
}
