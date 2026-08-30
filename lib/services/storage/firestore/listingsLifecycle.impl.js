/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsLifecycle.impl.js — Firestore implementation of listings lifecycle functions.
 *
 * Active-check failure tracking, deactivation/reactivation, retention purge,
 * price observation/change/history, geocode candidates, and setters.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { listingsCol, watchCol } from './listingsShared.js';
import { batched, BATCH_LIMIT } from './collections.js';

// ---------------------------------------------------------------------------
// Constants (match SQLite reference)
// ---------------------------------------------------------------------------
export const ACTIVE_CHECK_FAILURE_LIMIT = 10;
export const ACTIVE_CHECK_FAILURE_RETRY_MS = 24 * 60 * 60 * 1000;
export const PRICE_CHECK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Hard delete listings that have been offline longer than the retention period.
 * Also deletes their watch_list entries. Uses recursiveDelete for subcollections.
 */
export const purgeExpiredInactiveListings = async ({ retentionDays, now = Date.now() }) => {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) return { changes: 0 };
  const cutoff = now - Math.floor(retentionDays) * 24 * 60 * 60 * 1000;

  // Find candidates: inactive, with inactiveSince <= cutoff
  const snapshot = await listingsCol().where('isActive', '==', false).get();

  const toPurge = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.inactiveSince == null) continue;
    if (d.inactiveSince > cutoff) continue;
    toPurge.push(doc);
  }

  // Exclude those on the watch list
  const watchSnapshot = await watchCol().get();
  const watchedListingIds = new Set();
  for (const wDoc of watchSnapshot.docs) {
    const wd = wDoc.data();
    if (wd.listingId) watchedListingIds.add(wd.listingId);
  }

  const purgeList = toPurge.filter((doc) => !watchedListingIds.has(doc.id));

  if (purgeList.length === 0) return { changes: 0 };

  const db = FirestoreConnection.getConnection();

  // Delete watch_list entries for purged listings, then recursiveDelete each listing doc
  for (const doc of purgeList) {
    // Delete any watch_list entries referencing this listing
    const watchEntries = await watchCol().where('listingId', '==', doc.id).get();
    for (const we of watchEntries.docs) {
      await we.ref.delete();
    }
    // recursiveDelete removes the doc and its subcollections (price_history, travel_times)
    await db.recursiveDelete(doc.ref);
  }

  return { changes: purgeList.length };
};

// ---------------------------------------------------------------------------
// Price tracking
// ---------------------------------------------------------------------------

/**
 * Listings due for a price probe.
 */
export const getListingsDueForPriceCheck = async ({
  limit = 100,
  staleAfterMs = PRICE_CHECK_STALE_MS,
  now = Date.now(),
} = {}) => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100;
  const staleBefore = now - staleAfterMs;

  const snapshot = await listingsCol().where('manuallyDeleted', '==', false).get();

  const candidates = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    // Must be active
    if (d.isActive === false) continue;
    // Must have a link
    if (d.link == null) continue;

    const lastPriceCheck = d.lastPriceCheckAt ?? null;

    if (lastPriceCheck == null || lastPriceCheck <= staleBefore) {
      candidates.push({
        id: doc.id,
        link: d.link,
        provider: d.provider,
        price: d.price ?? null,
        job_id: d.jobId,
        lastPriceCheckAt: lastPriceCheck,
      });
    }
  }

  // Sort: never-checked first, then oldest
  candidates.sort((a, b) => {
    if (a.lastPriceCheckAt == null && b.lastPriceCheckAt == null) return 0;
    if (a.lastPriceCheckAt == null) return -1;
    if (b.lastPriceCheckAt == null) return 1;
    return a.lastPriceCheckAt - b.lastPriceCheckAt;
  });

  return candidates.slice(0, safeLimit).map(({ id, link, provider, price, job_id }) => ({
    id,
    link,
    provider,
    price,
    job_id,
  }));
};

/**
 * Record that these listings had their price looked at.
 */
export const markListingsPriceChecked = async (ids, checkedAt = Date.now()) => {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  let changes = 0;
  await batched(ids, (batch, id) => {
    batch.update(listingsCol().doc(id), { lastPriceCheckAt: checkedAt });
    changes++;
  });
  return { changes };
};

/**
 * Append one price reading to a listing's history subcollection.
 */
export const recordPriceObservation = async (listingId, price, observedAt = Date.now(), source = null) => {
  if (!listingId || !Number.isFinite(price)) return undefined;
  const priceHistoryCol = listingsCol().doc(listingId).collection('price_history');
  await priceHistoryCol.add({
    listingId,
    price: Math.round(price),
    observedAt,
    source,
  });
  return { changes: 1 };
};

/**
 * Move a listing to a new current price, keeping the old one as previous_price.
 */
export const applyPriceChange = async (listingId, newPrice, changedAt = Date.now()) => {
  if (!listingId || !Number.isFinite(newPrice)) return undefined;
  const ref = listingsCol().doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return undefined;
  const currentPrice = snap.data().price ?? null;
  await ref.update({
    previousPrice: currentPrice,
    price: Math.round(newPrice),
    priceChangedAt: changedAt,
  });
  return { changes: 1 };
};

/**
 * A listing's price readings, oldest first.
 */
export const getPriceHistory = async (listingId, { limit = 200 } = {}) => {
  if (!listingId) return [];
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
  const priceHistoryCol = listingsCol().doc(listingId).collection('price_history');
  const snapshot = await priceHistoryCol.orderBy('observedAt', 'asc').limit(safeLimit).get();
  return snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      price: d.price,
      observed_at: d.observedAt,
      source: d.source ?? null,
    };
  });
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
 * Set or clear the status of a listing. Status is stored as JSON string for SQLite compat.
 */
export const setListingStatus = (id, status) => {
  if (!id) return 0;
  const allowed = ['applied', 'rejected', 'accepted'];
  const normalized = status == null ? null : String(status).toLowerCase();
  if (normalized != null && !allowed.includes(normalized)) {
    throw new Error(`Invalid listing status: ${status}`);
  }
  // Validation passed synchronously; now do async Firestore work.
  const payload = normalized == null ? null : JSON.stringify({ status: normalized, setAt: Date.now() });
  return (async () => {
    const ref = listingsCol().doc(id);
    const snap = await ref.get();
    if (!snap.exists) return 0;
    await ref.update({ status: payload });
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
// getListingById and deleteListingsById are provided by listingsCore.impl.js
