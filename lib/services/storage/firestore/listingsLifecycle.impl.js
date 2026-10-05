/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsLifecycle.impl.js — Firestore implementation of listings lifecycle functions.
 *
 * Active-check failure tracking, deactivation/reactivation,
 * price observation/change/history, geocode candidates, and setters.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { listingsCol } from './listingsShared.js';
import { batched, BATCH_LIMIT } from './collections.js';
import { LISTING_LIFECYCLE_STATES, lifecycleFromData, transitionLifecycle } from '../../listings/listingLifecycle.js';
import { ARCHIVED_STATE, MIN_AUTO_ARCHIVE_MS, isListingStaleForArchive } from '../../listings/staleArchive.js';

// ---------------------------------------------------------------------------
// Lifecycle constants
// ---------------------------------------------------------------------------
export const ACTIVE_CHECK_FAILURE_LIMIT = 10;
export const ACTIVE_CHECK_FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Active-check lifecycle
// ---------------------------------------------------------------------------

/**
 * Listings due for an "is this still online?" probe.
 */
export const getListingsDueForActiveCheck = async ({
  limit = 500,
  staleAfterMs = 7 * 24 * 60 * 60 * 1000,
  failureRetryMs = ACTIVE_CHECK_FAILURE_RETRY_MS,
  now = Date.now(),
} = {}) => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
  const staleBefore = now - staleAfterMs;
  const failureRetryBefore = now - failureRetryMs;
  const maxFailures = ACTIVE_CHECK_FAILURE_LIMIT - 1;

  // Fetch active, non-deleted, non-manual listings
  const snapshot = await listingsCol().where('manuallyDeleted', '==', false).get();

  const candidates = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    // Must be active (true or null/undefined treated as active)
    if (d.isActive === false) continue;
    // Must not be manually overridden
    if (d.activityIsManual === true) continue;

    const lastChecked = d.lastCheckedAt ?? null;
    const failures = d.activeCheckFailures ?? 0;

    if (lastChecked == null) {
      // Never checked — highest priority (sort first)
      candidates.push({ id: doc.id, link: d.link, provider: d.provider, lastCheckedAt: null });
    } else if (failures === 0 && lastChecked <= staleBefore) {
      // No failures, but stale
      candidates.push({ id: doc.id, link: d.link, provider: d.provider, lastCheckedAt: lastChecked });
    } else if (failures >= 1 && failures <= maxFailures && lastChecked <= failureRetryBefore) {
      // Running failure streak, due for retry
      candidates.push({ id: doc.id, link: d.link, provider: d.provider, lastCheckedAt: lastChecked });
    }
  }

  // Sort: never-checked first (null), then by lastCheckedAt ascending
  candidates.sort((a, b) => {
    if (a.lastCheckedAt == null && b.lastCheckedAt == null) return 0;
    if (a.lastCheckedAt == null) return -1;
    if (b.lastCheckedAt == null) return 1;
    return a.lastCheckedAt - b.lastCheckedAt;
  });

  return candidates.slice(0, safeLimit).map(({ id, link, provider }) => ({ id, link, provider }));
};

/**
 * Record that these listings were probed and got a definitive answer.
 * Clears the failure counter.
 */
export const markListingsChecked = async (ids, checkedAt = Date.now()) => {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  let changes = 0;
  await batched(ids, (batch, id) => {
    batch.update(listingsCol().doc(id), {
      lastCheckedAt: checkedAt,
      activeCheckFailures: 0,
    });
    changes++;
  });
  return { changes };
};

/**
 * Count one more failed probe for each listing. Returns ids that reached the failure limit.
 */
export const recordActiveCheckFailures = async (
  ids,
  { checkedAt = Date.now(), failureLimit = ACTIVE_CHECK_FAILURE_LIMIT } = {},
) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const exhausted = [];

  // Must read-then-write since Firestore has no atomic increment+return
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const db = FirestoreConnection.getConnection();
    const batch = db.batch();

    for (const id of chunk) {
      const ref = listingsCol().doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const current = snap.data().activeCheckFailures ?? 0;
      const newCount = current + 1;
      batch.update(ref, {
        activeCheckFailures: newCount,
        lastCheckedAt: checkedAt,
      });
      if (newCount >= failureLimit) {
        exhausted.push(id);
      }
    }
    await batch.commit();
  }

  return exhausted;
};

/**
 * Deactivate listings. Stamps inactive_since (COALESCE — keeps first timestamp).
 */
export const deactivateListings = async (ids, inactiveSince = Date.now()) => {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  let changes = 0;

  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const db = FirestoreConnection.getConnection();
    const batch = db.batch();

    for (const id of chunk) {
      const ref = listingsCol().doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const d = snap.data();
      batch.update(ref, {
        isActive: false,
        inactiveSince: d.inactiveSince ?? inactiveSince,
        activeCheckFailures: 0,
      });
      changes++;
    }
    await batch.commit();
  }

  return { changes };
};

/**
 * Re-activate listings — human override. Sets activityIsManual so the alive-checker
 * won't re-check them. Skips soft-deleted listings.
 */
export const reactivateListings = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  let changes = 0;

  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const chunk = ids.slice(i, i + BATCH_LIMIT);
    const db = FirestoreConnection.getConnection();
    const batch = db.batch();

    for (const id of chunk) {
      const ref = listingsCol().doc(id);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const d = snap.data();
      // Skip soft-deleted
      if (d.manuallyDeleted) continue;

      batch.update(ref, {
        isActive: true,
        inactiveSince: null,
        activeCheckFailures: 0,
        activityIsManual: true,
      });
      changes++;
    }
    await batch.commit();
  }

  return { changes };
};

// ---------------------------------------------------------------------------
// Geocoding candidates
// ---------------------------------------------------------------------------

/**
 * Return active listings with address but no coordinates.
 */
export const getListingsToGeocode = async () => {
  const snapshot = await listingsCol().where('isActive', '==', true).where('manuallyDeleted', '==', false).get();

  const results = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.address == null) continue;
    if (d.addressIsManual === true) continue;
    if (d.latitude != null && d.longitude != null) continue;
    results.push({ id: doc.id, address: d.address, provider: d.provider });
  }
  return results;
};

/**
 * Update geocoordinates for a listing.
 */
export const updateListingGeocoordinates = async (id, latitude, longitude) => {
  await listingsCol().doc(id).update({ latitude, longitude });
};

/**
 * Return cached geocoordinates for a given address string, if any listing has them.
 */
export const getGeocoordinatesByAddress = async (address, providerIds = null) => {
  const snapshot = await listingsCol().where('address', '==', address).where('manuallyDeleted', '==', false).get();

  const scoped = Array.isArray(providerIds) && providerIds.length > 0;

  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.latitude == null || d.longitude == null) continue;
    if (d.latitude === -1 && d.longitude === -1) continue;
    if (scoped && !providerIds.includes(d.provider)) continue;
    return { lat: d.latitude, lng: d.longitude };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Setters (notes, status, address)
// ---------------------------------------------------------------------------

/**
 * Set or clear notes on a listing. Returns the number of rows affected.
 */
export const setListingNotes = async (id, notes) => {
  if (!id) return 0;
  const trimmed = typeof notes === 'string' ? notes.trim() : null;
  const value = trimmed && trimmed.length > 0 ? trimmed : null;
  const ref = listingsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  await ref.update({ notes: value });
  return 1;
};

/**
 * Store (or clear) the eager-generated inquiry draft for a listing.
 * @param {string} id
 * @param {string|null} message
 * @returns {Promise<number>} rows affected
 */
export const setInquiryMessage = async (id, message) => {
  if (!id) return 0;
  const trimmed = typeof message === 'string' ? message.trim() : null;
  const value = trimmed && trimmed.length > 0 ? trimmed : null;
  const ref = listingsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  await ref.update({ inquiryMessage: value });
  return 1;
};

/**
 * Persist the notification-complete boolean once a listing's one notification has durably gone out
 * (successful `_notify`), or reconciled from durable evidence during a repair pass.
 *
 * Write-once by design: it only ever sets the flag to `true` and never clears it, so it can be
 * safely (re)run. A second call on an already-flagged row makes no write and reports 0, which is
 * what keeps the reconcile pass idempotent. `notifiedAt` is stamped only on the first transition.
 *
 * @param {string} id
 * @param {number} [notifiedAt]
 * @returns {Promise<number>} 1 when it flipped the flag, 0 when already set or missing.
 */
export const markNotificationComplete = async (id, notifiedAt = Date.now()) => {
  if (!id) return 0;
  const ref = listingsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  if (snap.data().notificationComplete === true) return 0;
  await ref.update({ notificationComplete: true, notifiedAt });
  return 1;
};

/**
 * Atomically reserve a listing for one inquiry attempt.
 * @param {string} id
 * @param {number} [startedAt]
 * @returns {Promise<boolean>}
 */
export const reserveInquirySend = async (id, startedAt = Date.now()) => {
  if (!id) return false;
  const ref = listingsCol().doc(id);
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return false;
    const status = snap.data().inquirySendStatus ?? null;
    if (status != null && status !== 'failed') return false;
    transaction.update(ref, {
      inquirySendStatus: 'sending',
      inquirySendStartedAt: startedAt,
      inquirySentAt: null,
      inquiryRequestId: null,
      inquirySendError: null,
    });
    return true;
  });
};

/**
 * Finish a reserved inquiry attempt.
 * @param {string} id
 * @param {{status: 'sent'|'failed'|'rejected'|'unknown', requestId?: string|null, sentAt?: number|null, error?: string|null}} result
 * @returns {Promise<number>}
 */
export const finishInquirySend = async (id, { status, requestId = null, sentAt = null, error = null }) => {
  if (!id) return 0;
  if (!['sent', 'failed', 'rejected', 'unknown'].includes(status)) {
    throw new Error(`Invalid inquiry send status: ${status}`);
  }
  const ref = listingsCol().doc(id);
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data().inquirySendStatus !== 'sending') return 0;
    const data = snap.data();
    const update = {
      inquirySendStatus: status,
      inquirySentAt: sentAt,
      inquiryRequestId: requestId,
      inquirySendError: error,
    };
    if (status === 'sent') {
      const changedAt = sentAt ?? Date.now();
      update.lifecycle = transitionLifecycle(lifecycleFromData(data), 'applied', {
        changedAt,
        source: 'provider-confirmed',
      });
    }
    transaction.update(ref, update);
    return 1;
  });
};

/**
 * Set a canonical lifecycle action.
 * @param {string} id
 * @param {string|null} status
 * @param {string|null} [changedBy]
 */
export const setListingStatus = (id, status, changedBy = null) => {
  if (!id) return 0;
  const allowed = [
    'applied',
    'rejected',
    'accepted',
    'viewed',
    'viewing',
    'archived',
    'archive',
    'new',
    'reset',
    'restore',
  ];
  const normalized = status == null ? null : String(status).toLowerCase();
  if (normalized != null && !allowed.includes(normalized)) {
    throw new Error(`Invalid listing status: ${status}`);
  }
  // Validation passed synchronously; now do async Firestore work.
  return (async () => {
    const ref = listingsCol().doc(id);
    const snap = await ref.get();
    if (!snap.exists) return 0;
    const changedAt = Date.now();
    const lifecycle = transitionLifecycle(lifecycleFromData(snap.data()), normalized, {
      changedAt,
      changedBy,
      source: normalized === 'accepted' || normalized === 'rejected' ? 'legacy-status' : 'manual',
    });
    await ref.update({ lifecycle });
    return 1;
  })();
};

/**
 * Overwrite a listing's address and coordinates with user-provided values.
 * Clears distances and travel time state. Returns number of rows affected.
 */
export const setListingAddress = async (id, address, latitude, longitude) => {
  if (!id) return 0;
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (trimmed.length === 0) return 0;

  const ref = listingsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 0;

  await ref.update({
    address: trimmed,
    latitude,
    longitude,
    addressIsManual: true,
    distances: null,
    travelTimesAt: null,
    travelTimeFailures: 0,
  });

  // Delete travel times subcollection
  const travelTimesCol = ref.collection('travel_times');
  const ttSnapshot = await travelTimesCol.get();
  if (!ttSnapshot.empty) {
    await batched(ttSnapshot.docs, (batch, doc) => {
      batch.delete(doc.ref);
    });
  }

  return 1;
};

/**
 * Auto-archive a single job's listings whose per-state age window has elapsed.
 *
 * This is the storage half of the auto-archive sweep the job run drives. It is scoped to exactly one
 * `jobId`, and a job belongs to exactly one user, so the sweep can never reach across the per-user
 * lifecycle boundary — it only ever moves rows the job's owner already sees. The staleness decision
 * is the pure {@link isListingStaleForArchive} rule (per-lifecycle-state windows — 14 days for
 * `new`, 30 for `applied`, 45 for `viewed` — measured from when the row entered that state, strict
 * boundary, never a row already archived), so the boundary is tested independently of Firestore.
 *
 * It transitions a stale listing to the canonical `archived` state exactly the way a manual
 * {@link setListingStatus} would, writing the canonical lifecycle object. It NEVER deletes and never touches a
 * soft-deleted (`manuallyDeleted`) row — archiving is a lifecycle move, not a purge, and the
 * nothing in Fredy removes a listing on its own. Running it twice is a no-op: the
 * second pass finds every row already archived and skips it.
 *
 * @param {string} jobId The job whose listings to sweep.
 * @param {{ now?: number }} [options] Reference time (epoch millis); defaults to the wall clock.
 * @returns {Promise<{ archived: number }>} How many listings this pass moved to archived.
 */
export const archiveStaleListingsForJob = async (jobId, { now = Date.now() } = {}) => {
  if (!jobId) return { archived: 0 };

  // Only the rows the sweep could possibly act on: live, not yet archived, and created before the
  // widest-possible cutoff. The prefilter uses the SMALLEST window (14 days): a listing reaches
  // `applied`/`viewed` only after it was created, so once it is past its 30/45-day window it is
  // necessarily more than 14 days old by createdAt — the broad createdAt cutoff can never drop a
  // row the per-state rule would archive. Reading the whole job and filtering in memory cost one
  // read per stored listing on every run, most of the run's reads. The query shape is unchanged
  // (same where clauses, no new field) so no composite index changes. Soft-deleted tombstones are
  // never archived - they are already out of the user's active view, and only a user action owns
  // their removal. The pure rule below is still applied per row, so the strict per-state boundary,
  // the fallback chain and the unparseable-timestamp guard stay where they are tested.
  const activeStates = LISTING_LIFECYCLE_STATES.filter((state) => state !== ARCHIVED_STATE);
  const snapshot = await listingsCol()
    .where('jobId', '==', jobId)
    .where('manuallyDeleted', '==', false)
    .where('lifecycle.state', 'in', activeStates)
    .where('createdAt', '<', now - MIN_AUTO_ARCHIVE_MS)
    .get();

  const stale = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.manuallyDeleted === true) continue;
    const lifecycle = lifecycleFromData(data);
    if (isListingStaleForArchive({ createdAt: data.createdAt, lifecycle }, { now })) {
      stale.push({ id: doc.id, lifecycle });
    }
  }

  if (stale.length === 0) return { archived: 0 };

  await batched(stale, (batch, { id, lifecycle }) => {
    const next = transitionLifecycle(lifecycle, 'archived', { changedAt: now, source: 'auto-archive' });
    batch.update(listingsCol().doc(id), {
      lifecycle: next,
    });
  });

  return { archived: stale.length };
};
// getListingById and deleteListingsById are provided by listingsCore.impl.js
