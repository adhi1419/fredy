/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Shared listing document shape + anchor functions for the Firestore backend.
 *
 * CANONICAL DOC SHAPE (collection `listings`, doc id = sha1(jobId NUL hash)):
 *   hash, provider, jobId, price, size, rooms, buildYear, energyClass, title,
 *   imageUrl, description, address, link, createdAt, isActive (bool),
 *   manuallyDeleted (bool), latitude, longitude, distances (array|null),
 *   notes (string|null), lifecycle ({state, source, changedAt, changedBy, …}), inquiryMessage,
 *   inquirySendStatus, inquirySendStartedAt, inquirySentAt, inquiryRequestId, inquirySendError,
 *   notificationComplete, notifiedAt, inactiveSince, lastCheckedAt, activeCheckFailures,
 *   travelTimesAt, travelTimeFailures.
 *
 * API ROW SHAPE: functions return the established snake_case fields
 * (job_id, image_url, created_at, is_active, manually_deleted, …) expected by
 * API consumers and the contract suite.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS, listingDocId } from './collections.js';
import { fromJson } from '../../../utils.js';
import { attemptProjection, lifecycleFromData } from '../../listings/listingLifecycle.js';
import { toFirestoreListing } from './listingWriter.js';
import {
  addKnownListingIds,
  isKnownListingIndexLoaded,
  partitionKnownHashes,
  replaceKnownListingIds,
} from './knownListingIndex.js';

export const listingsCol = () => FirestoreConnection.collection(COLLECTIONS.LISTINGS);
export const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);
export const watchCol = () => FirestoreConnection.collection(COLLECTIONS.WATCH_LIST);

/** Map a Firestore document snapshot to the established API row shape. */
export function toApiRow(snap) {
  const d = snap.data();
  return {
    id: snap.id,
    created_at: d.createdAt ?? null,
    hash: d.hash ?? null,
    provider: d.provider ?? null,
    job_id: d.jobId ?? null,
    price: d.price ?? null,
    size: d.size ?? null,
    rooms: d.rooms ?? null,
    build_year: d.buildYear ?? null,
    energy_class: d.energyClass ?? null,
    title: d.title ?? null,
    image_url: d.imageUrl ?? null,
    description: d.description ?? null,
    address: d.address ?? null,
    link: d.link ?? null,
    is_active: d.isActive ? 1 : 0,
    manually_deleted: d.manuallyDeleted ? 1 : 0,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    distances: d.distances ?? null,
    notes: d.notes ?? null,
    inquiry_message: d.inquiryMessage ?? null,
    inquiry_send_status: d.inquirySendStatus ?? null,
    inquiry_send_started_at: d.inquirySendStartedAt ?? null,
    inquiry_sent_at: d.inquirySentAt ?? null,
    inquiry_request_id: d.inquiryRequestId ?? null,
    inquiry_send_error: d.inquirySendError ?? null,
    lifecycle: lifecycleFromData(d),
    notification_complete: d.notificationComplete === true ? 1 : 0,
    notified_at: d.notifiedAt ?? null,
    application: {
      attempt: attemptProjection(d.inquirySendStatus, {
        startedAt: d.inquirySendStartedAt,
        finishedAt: d.inquirySentAt,
        requestId: d.inquiryRequestId,
        error: d.inquirySendError,
      }),
    },
    last_checked_at: d.lastCheckedAt ?? null,
    active_check_failures: d.activeCheckFailures ?? 0,
    travel_times_at: d.travelTimesAt ?? null,
    travel_time_failures: d.travelTimeFailures ?? 0,
    address_is_manual: d.addressIsManual ? 1 : 0,
    activity_is_manual: d.activityIsManual ? 1 : 0,
    inactive_since: d.inactiveSince ?? null,
  };
}

/** Mirrors listingsStorage.parseListingStatus: JSON columns parsed to objects. */
export function parseListingStatus(row) {
  if (row == null) return row;
  const out = { ...row };
  if (typeof out.distances === 'string') out.distances = fromJson(out.distances, null);
  return out;
}

/**
 * User scoping: a user sees listings of jobs they own or that are shared with
 * them. Admin status is intentionally ignored; product visibility is tenant-scoped.
 */
export async function accessibleJobIds(userId) {
  const effective = userId || '__NO_USER__';
  const snapshot = await jobsCol().get();
  const ids = new Set();
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.userId === effective || (Array.isArray(d.sharedWithUser) && d.sharedWithUser.includes(effective))) {
      ids.add(doc.id);
    }
  }
  return ids;
}

/**
 * storeListings — replaces INSERT ... ON CONFLICT(job_id, hash) DO NOTHING RETURNING id.
 *
 * The doc id is deterministic (sha1 of jobId+hash), so create() failing with
 * ALREADY_EXISTS is exactly the conflict path, and propagating "the existing
 * row's id" onto item.id is automatic. The public storage contract mutates
 * each input item by assigning item.id.
 */
export const storeListings = async (jobId, providerId, listings) => {
  if (!Array.isArray(listings) || listings.length === 0) {
    return;
  }
  for (const item of listings) {
    const hash = item.id;
    const docId = listingDocId(jobId, hash);
    const doc = toFirestoreListing(jobId, providerId, item);
    try {
      await listingsCol().doc(docId).create(doc);
    } catch (err) {
      // ALREADY_EXISTS (gRPC code 6): the conflict path — keep the existing row.
      if (err?.code !== 6) throw err;
    }
    addKnownListingIds([docId]);
    item.id = docId;
  }
};

/**
 * Find the subset of candidate hashes already stored for a job and provider.
 *
 * Hashes the in-memory {@link module:knownListingIndex} knows are answered without a read. A
 * listing's document id is `listingDocId(jobId, hash)`, so an index hit means that exact document
 * exists - the same row `storeListings` would collide with. The rest go to Firestore; Firestore's
 * `in` operator accepts at most 30 values, so larger sets are chunked.
 *
 * @param {string} jobId
 * @param {string} providerId
 * @param {string[]} hashes Candidate provider hashes.
 * @returns {Promise<string[]>}
 */
export const findKnownHashes = async (jobId, providerId, hashes) => {
  if (!jobId || !providerId || !Array.isArray(hashes) || hashes.length === 0) return [];
  const unique = [...new Set(hashes.filter((hash) => typeof hash === 'string' && hash.length > 0))];
  // The in-memory index answers for every listing it knows, which on a warm instance is nearly all
  // of a scrape. Only its misses - genuinely new listings, or rows it has not seen yet - cost a read.
  const { known, unconfirmed: candidates } = partitionKnownHashes(jobId, unique);
  const found = new Set(known);
  for (let offset = 0; offset < candidates.length; offset += 30) {
    const chunk = candidates.slice(offset, offset + 30);
    const snapshot = await listingsCol()
      .where('jobId', '==', jobId)
      .where('provider', '==', providerId)
      .where('hash', 'in', chunk)
      .get();
    for (const doc of snapshot.docs) {
      const hash = doc.data().hash;
      if (hash != null) found.add(hash);
      addKnownListingIds([doc.id]);
    }
  }
  return [...found];
};

/**
 * @deprecated Use findKnownHashes(jobId, providerId, hashes) to bound reads.
 */
export const getKnownListingHashesForJobAndProvider = async (jobId, providerId) => {
  const snapshot = await listingsCol().where('jobId', '==', jobId).where('provider', '==', providerId).get();
  return snapshot.docs.map((d) => d.data().hash);
};

/**
 * Every non-deleted listing's similarity-relevant fields for cache rebuilds:
 * job_id, provider, title, address, price, size, rooms and description.
 *
 * The first call in a process reads the whole collection instead, tombstones included, and loads
 * the known-listing index (see knownListingIndex.js) from it: a listing the user deleted must stay
 * known, or the next scrape would bring it back as new. Later calls read live rows only. The index
 * does not need those reloads - it grows on every write and confirmed miss and shrinks on every hard
 * delete - and tombstones outnumber live listings, so re-reading them hourly would cost more than
 * the index saves.
 */
export const getAllEntriesFromListings = async () => {
  let live;
  if (isKnownListingIndexLoaded()) {
    live = (await listingsCol().where('manuallyDeleted', '==', false).get()).docs;
  } else {
    const snapshot = await listingsCol().get();
    replaceKnownListingIds(snapshot.docs.map((snap) => snap.id));
    live = snapshot.docs.filter((snap) => snap.data().manuallyDeleted !== true);
  }
  return live.map((snap) => {
    const d = snap.data();
    return {
      job_id: d.jobId ?? null,
      provider: d.provider ?? null,
      title: d.title ?? null,
      address: d.address ?? null,
      price: d.price ?? null,
      size: d.size ?? null,
      rooms: d.rooms ?? null,
      description: d.description ?? null,
    };
  });
};
