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
 *   notes (string|null), status (string|null),
 *   lastCheckedAt, activeCheckFailures, lastPriceCheckAt, previousPrice,
 *   travelTimesAt, travelTimeFailures, addressIsManual (bool),
 *   connectivity* fields (see lifecycle/geoKpi impls).
 *
 * API ROW SHAPE: functions return rows with the SQLite column names
 * (snake_case: job_id, image_url, created_at, is_active, manually_deleted, …)
 * because that is what every consumer — and the contract suite — expects.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS, listingDocId, numericAffinity } from './collections.js';
import { fromJson } from '../../../utils.js';

export const listingsCol = () => FirestoreConnection.collection(COLLECTIONS.LISTINGS);
export const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);
export const watchCol = () => FirestoreConnection.collection(COLLECTIONS.WATCH_LIST);

const nullOrEmpty = (str) => str == null || String(str).trim().length === 0;

function removeParentheses(str) {
  if (nullOrEmpty(str)) return null;
  return str.replace(/\s*\([^)]*\)/g, '');
}

/** Map a Firestore doc snapshot to the SQLite row shape (l.* columns). */
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
    status: d.status ?? null,
    last_checked_at: d.lastCheckedAt ?? null,
    active_check_failures: d.activeCheckFailures ?? 0,
    last_price_check_at: d.lastPriceCheckAt ?? null,
    previous_price: d.previousPrice ?? null,
    travel_times_at: d.travelTimesAt ?? null,
    travel_time_failures: d.travelTimeFailures ?? 0,
    address_is_manual: d.addressIsManual ? 1 : 0,
    activity_is_manual: d.activityIsManual ? 1 : 0,
    inactive_since: d.inactiveSince ?? null,
    connectivity: d.connectivity ?? null,
    connectivity_max_down: d.connectivityMaxDown ?? null,
    connectivity_fiber: d.connectivityFiber ?? null,
    connectivity_mobile: d.connectivityMobileBits ?? null,
    connectivity_at: d.connectivityCheckedAt ?? null,
  };
}

/** Mirrors listingsStorage.parseListingStatus: JSON columns parsed to objects. */
export function parseListingStatus(row) {
  if (row == null) return row;
  const out = { ...row };
  if (typeof out.status === 'string') out.status = fromJson(out.status, null);
  if (typeof out.distances === 'string') out.distances = fromJson(out.distances, null);
  if (typeof out.connectivity === 'string') out.connectivity = fromJson(out.connectivity, null);
  return out;
}

/**
 * User scoping — mirrors USER_LISTING_SET_SCOPE_SQL: a user sees listings of
 * jobs they own or that are shared with them. Returns the set of accessible
 * jobIds, or null for admins (no restriction).
 */
export async function accessibleJobIds(userId, isAdmin) {
  if (isAdmin) return null;
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
 * row's id" onto item.id is automatic. MUTATES the input items (item.id),
 * matching the sqlite implementation.
 */
export const storeListings = async (jobId, providerId, listings) => {
  if (!Array.isArray(listings) || listings.length === 0) {
    return;
  }
  for (const item of listings) {
    const hash = item.id;
    const docId = listingDocId(jobId, hash);
    const doc = {
      hash,
      provider: providerId,
      jobId,
      price: numericAffinity(item.price),
      size: numericAffinity(item.size),
      rooms: numericAffinity(item.rooms),
      buildYear: item.buildYear ?? null,
      energyClass: item.energyClass ?? null,
      title: item.title ?? null,
      imageUrl: item.image ?? null,
      description: item.description ?? null,
      address: removeParentheses(item.address),
      link: item.link ?? null,
      createdAt: Date.now(),
      isActive: true,
      manuallyDeleted: false,
      latitude: item.latitude || null,
      longitude: item.longitude || null,
      distances: null,
      notes: null,
      status: null,
    };
    try {
      await listingsCol().doc(docId).create(doc);
    } catch (err) {
      // ALREADY_EXISTS (gRPC code 6): the conflict path — keep the existing row.
      if (err?.code !== 6) throw err;
    }
    item.id = docId;
  }
};

/**
 * All stored hashes for a job+provider — INCLUDING soft-deleted tombstones.
 * The tombstone is what prevents re-notification; do not filter here.
 */
export const getKnownListingHashesForJobAndProvider = async (jobId, providerId) => {
  const snapshot = await listingsCol().where('jobId', '==', jobId).where('provider', '==', providerId).get();
  return snapshot.docs.map((d) => d.data().hash);
};
