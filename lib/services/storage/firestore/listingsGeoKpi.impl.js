/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsGeoKpi.impl.js — Firestore implementation of GEO / TRAVEL / KPI / CONNECTIVITY.
 *
 * Exports implement the public listings-storage contract. Travel times live
 * in `listings/{id}/travel_times` with delete-then-write replacement semantics.
 * KPI, median, per-day and distribution values are computed in memory after
 * user-scoped Firestore fetches.
 */

import { listingsCol, jobsCol, accessibleJobIds } from './listingsShared.js';
import { batched } from './collections.js';
import { fromJson } from '../../../utils.js';
import { lifecycleFromData } from '../../listings/listingLifecycle.js';

// ───────────────────────────── constants ──────────────────────────────────

export const TRAVEL_TIME_FAILURE_LIMIT = 5;

// ───────────────────────────── helpers ────────────────────────────────────

/** Valid geocoordinates: non-null and not the -1/-1 "geocoder found nothing" marker. */
function hasValidCoords(d) {
  return d.latitude != null && d.longitude != null && d.latitude !== -1 && d.longitude !== -1;
}

/** Local-time YYYY-MM-DD key for a date. */
function toDayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Turn one stored travel-time document into the API/UI list-view shape,
 * omitting route geometry.
 */
function toTravelTimeEntry(row) {
  const entry = {
    addressId: row.address_id,
    label: row.label,
    mode: row.estimate_mode ?? null,
    estimate: row.is_estimate !== 0,
    referenceTime: row.reference_time,
    computedAt: row.computed_at,
  };
  if (row.transit_minutes != null) {
    entry.transit = { minutes: row.transit_minutes, transfers: row.transit_transfers ?? 0 };
    const legs = row.transit_legs ? fromJson(row.transit_legs, null) : null;
    if (Array.isArray(legs) && legs.length > 0) {
      entry.transit.legs = legs.map(({ geometry: _g, ...leg }) => leg); // eslint-disable-line no-unused-vars
    }
  }
  if (row.car_minutes != null) {
    entry.car = { minutes: row.car_minutes, distanceMeters: row.car_distance_meters ?? null };
  }
  if (row.bike_minutes != null) {
    entry.bike = { minutes: row.bike_minutes };
  }
  if (row.walk_minutes != null) {
    entry.walk = { minutes: row.walk_minutes };
  }
  if (row.via_stops) {
    const via = fromJson(row.via_stops, null);
    if (Array.isArray(via) && via.length > 0) {
      entry.via = via;
    }
  }
  return entry;
}

// ───────────────────────────── distances ──────────────────────────────────

export const updateListingDistances = async (id, distances) => {
  await listingsCol()
    .doc(id)
    .update({ distances: distances ?? null });
};

export const getListingsToCalculateDistance = async (jobId) => {
  const snapshot = await listingsCol()
    .where('jobId', '==', jobId)
    .where('isActive', '==', true)
    .where('manuallyDeleted', '==', false)
    .get();

  return snapshot.docs
    .filter((doc) => {
      const d = doc.data();
      return d.latitude != null && d.longitude != null && d.distances == null;
    })
    .map((doc) => {
      const d = doc.data();
      return { id: doc.id, latitude: d.latitude, longitude: d.longitude };
    });
};

export const getListingsForUserToCalculateDistance = async (userId) => {
  // Find all jobs owned by this user.
  const jobSnap = await jobsCol().where('userId', '==', userId).get();
  const jobIds = jobSnap.docs.map((d) => d.id);
  if (jobIds.length === 0) return [];

  const results = [];
  for (const jobId of jobIds) {
    const snap = await listingsCol()
      .where('jobId', '==', jobId)
      .where('isActive', '==', true)
      .where('manuallyDeleted', '==', false)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.latitude != null && d.longitude != null) {
        results.push({ id: doc.id, latitude: d.latitude, longitude: d.longitude });
      }
    }
  }
  return results;
};

// ───────────────────────────── travel times ──────────────────────────────

/**
 * Fetch travel time sub-docs for a listing as snake_case row objects.
 */
async function readTravelTimeDocs(listingId) {
  const subCol = listingsCol().doc(listingId).collection('travel_times');
  const snap = await subCol.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      listing_id: listingId,
      address_id: data.addressId ?? d.id,
      label: data.label ?? d.id,
      origin_lat: data.originLat ?? null,
      origin_lng: data.originLng ?? null,
      transit_minutes: data.transitMinutes ?? null,
      transit_transfers: data.transitTransfers ?? null,
      transit_legs: data.transitLegs ?? null,
      car_minutes: data.carMinutes ?? null,
      car_distance_meters: data.carDistanceMeters ?? null,
      car_geometry: data.carGeometry ?? null,
      bike_minutes: data.bikeMinutes ?? null,
      bike_geometry: data.bikeGeometry ?? null,
      walk_minutes: data.walkMinutes ?? null,
      walk_geometry: data.walkGeometry ?? null,
      via_stops: data.viaStops ?? null,
      estimate_mode: data.estimateMode ?? null,
      is_estimate: data.isEstimate ?? 1,
      reference_time: data.referenceTime ?? null,
      computed_at: data.computedAt ?? null,
    };
  });
}

/**
 * Replace a listing's travel times with the given set.
 * DELETE-then-write semantics: all existing sub-docs are removed, then new ones written.
 */
export const saveListingTravelTimes = async (listingId, entries, computedAt = Date.now()) => {
  if (!listingId) return;
  // One document per saved address, keyed by the address id so a rename moves nothing. The label is
  // kept beside it for display only.
  const rows = Array.isArray(entries)
    ? entries.filter((e) => e && typeof e.addressId === 'string' && e.addressId.length > 0)
    : [];

  const listingRef = listingsCol().doc(listingId);
  const subCol = listingRef.collection('travel_times');

  // Delete all existing travel time docs.
  const existing = await subCol.get();
  if (existing.docs.length > 0) {
    await batched(existing.docs, (batch, doc) => batch.delete(doc.ref));
  }

  // Write new entries.
  if (rows.length > 0) {
    await batched(rows, (batch, row) => {
      const docRef = subCol.doc(row.addressId);
      batch.set(docRef, {
        addressId: row.addressId,
        label: row.label ?? null,
        originLat: row.originLat ?? null,
        originLng: row.originLng ?? null,
        transitMinutes: row.transitMinutes ?? null,
        transitTransfers: row.transitTransfers ?? null,
        transitLegs: row.transitLegs == null ? null : JSON.stringify(row.transitLegs),
        carMinutes: row.carMinutes ?? null,
        carDistanceMeters: row.carDistanceMeters ?? null,
        carGeometry: row.carGeometry ?? null,
        bikeMinutes: row.bikeMinutes ?? null,
        bikeGeometry: row.bikeGeometry ?? null,
        walkMinutes: row.walkMinutes ?? null,
        walkGeometry: row.walkGeometry ?? null,
        viaStops: row.viaStops == null ? null : JSON.stringify(row.viaStops),
        estimateMode: row.estimateMode ?? null,
        isEstimate: row.isEstimate === false ? 0 : 1,
        referenceTime: row.referenceTime ?? null,
        computedAt: row.computedAt ?? computedAt,
      });
    });
  }

  // Stamp the listing and reset failures.
  await listingRef.update({
    travelTimesAt: computedAt,
    travelTimeFailures: 0,
  });
};

/**
 * The stored travel times of a set of listings, grouped by listing id.
 */
export const getTravelTimesForListings = async (ids) => {
  const byListing = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return byListing;

  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  for (const listingId of unique) {
    const rows = await readTravelTimeDocs(listingId);
    if (rows.length > 0) {
      byListing.set(listingId, rows);
    }
  }
  return byListing;
};

/**
 * Attach travel times to listing rows in-place.
 */
export const attachTravelTimes = async (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const byListing = await getTravelTimesForListings(rows.map((r) => r.id));
  for (const row of rows) {
    const stored = byListing.get(row.id);
    if (stored != null) {
      row.travelTimes = stored.map((entry) => toTravelTimeEntry(entry));
    }
  }
  return rows;
};

// ───────────────────────────── reconcile / repair ─────────────────────────

/**
 * Every KNOWN (already stored, not hard-deleted) listing of a job+provider, in the compact shape
 * the reconcile planner reads. This is the read side of "reconcile by stable identity" — it
 * returns the very rows `_findNew` drops, so a repair pass can look at what a fresh scrape never
 * revisits. Soft-deleted tombstones and inactive listings are excluded: an out-of-area/similar or
 * withdrawn listing must not be resurrected or applied to by repair.
 *
 * @param {string} jobId
 * @param {string} providerId
 * @returns {Promise<Object[]>} Canonical camelCase listing rows for the planner and provider adapters.
 */
export const getListingsNeedingRepair = async (jobId, providerId, { inquiries = false, drafts = false } = {}) => {
  if (!jobId || !providerId) return [];

  // One query per repair category, all scoped to this job and provider, so a healthy search costs a
  // handful of reads instead of one per stored listing. The canonical listing shape (listingWriter.js,
  // migration 005) stores every one of these fields, because Firestore cannot match an absent field.
  //
  // Categories the caller cannot act on are not queried at all. Most listings never get an inquiry
  // (the source is not automatic) or a generated draft (no generator or profile), so querying those
  // categories unconditionally would read nearly every stored row on every run.
  const base = () =>
    listingsCol()
      .where('jobId', '==', jobId)
      .where('provider', '==', providerId)
      .where('isActive', '==', true)
      .where('manuallyDeleted', '==', false);
  const queries = [
    // A notification that went out but was never marked complete. Never-notified rows are healthy.
    base().where('notificationComplete', '==', false).where('notifiedAt', '>', 0),
    // Never geocoded. The -1 "found nothing" marker is a final answer (see needsCoordinateRepair).
    base().where('latitude', '==', null),
  ];
  if (inquiries) {
    // A null status means no application attempt was recorded. It is not a repair signal because
    // notification drafts are generated before commute and listing-level provider eligibility.
    queries.push(base().where('inquirySendStatus', '==', 'failed'));
  }
  if (drafts) queries.push(base().where('inquiryMessage', '==', null));
  const snapshots = await Promise.all(queries.map((query) => query.get()));

  const byId = new Map();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      if (!byId.has(doc.id)) byId.set(doc.id, doc);
    }
  }

  return [...byId.values()].map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      hash: d.hash ?? null,
      provider: d.provider ?? null,
      jobId: d.jobId ?? null,
      title: d.title ?? null,
      price: d.price ?? null,
      size: d.size ?? null,
      rooms: d.rooms ?? null,
      description: d.description ?? null,
      address: d.address ?? null,
      link: d.link ?? null,
      isActive: d.isActive === true,
      latitude: d.latitude ?? null,
      longitude: d.longitude ?? null,
      inquiryMessage: d.inquiryMessage ?? null,
      inquirySendStatus: d.inquirySendStatus ?? null,
      notificationComplete: d.notificationComplete ?? null,
      notifiedAt: d.notifiedAt ?? null,
      createdAt: d.createdAt ?? null,
      lifecycleState: lifecycleFromData(d).state,
    };
  });
};

/**
 * Fill in a listing's coordinates during repair, but only over an absent/half/`-1,-1` position.
 * A valid stored coordinate is preserved verbatim — the same rule the pipeline's `isLocated` uses.
 * This makes coordinate repair idempotent: a second call with the same valid input is refused
 * because the row is now located.
 *
 * @param {string} id
 * @param {{ lat: number, lng: number }} coords
 * @returns {Promise<number>} 1 when the row was updated, 0 otherwise.
 */
export const repairListingCoordinates = async (id, { lat, lng } = {}) => {
  if (!id || typeof lat !== 'number' || typeof lng !== 'number' || (lat === -1 && lng === -1)) {
    return 0;
  }
  const ref = listingsCol().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const d = snap.data();
  const alreadyLocated = d.latitude != null && d.longitude != null && !(d.latitude === -1 && d.longitude === -1);
  if (alreadyLocated) return 0;
  await ref.update({ latitude: lat, longitude: lng });
  return 1;
};

/**
 * Record that a listing could not be routed to.
 */
export const recordTravelTimeFailure = async (listingId, checkedAt = Date.now()) => {
  if (!listingId) return;
  const ref = listingsCol().doc(listingId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const d = snap.data();
  await ref.update({
    travelTimeFailures: (d.travelTimeFailures ?? 0) + 1,
    travelTimesAt: checkedAt,
  });
};

/**
 * Mark listings as needing travel-time recomputation.
 */
export const markTravelTimesDirty = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await batched(ids, (batch, id) => {
    batch.update(listingsCol().doc(id), {
      travelTimesAt: null,
      travelTimeFailures: 0,
    });
  });
};

/**
 * Listings whose travel times need computing.
 */
export const getListingsDueForTravelTimes = async ({
  limit = 60,
  staleBefore = 0,
  failureLimit = TRAVEL_TIME_FAILURE_LIMIT,
} = {}) => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 60;

  // Fetch all active, non-deleted listings and filter in memory.
  const snap = await listingsCol().where('isActive', '==', true).where('manuallyDeleted', '==', false).get();

  // Build a set of jobId -> userId for the join.
  const jobIds = new Set(snap.docs.map((d) => d.data().jobId));
  const jobUserMap = new Map();
  if (jobIds.size > 0) {
    const jobSnap = await jobsCol().get();
    for (const doc of jobSnap.docs) {
      jobUserMap.set(doc.id, doc.data().userId ?? null);
    }
  }

  const withData = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!hasValidCoords(d)) continue;
    const failures = d.travelTimeFailures ?? 0;
    if (failures >= failureLimit) continue;
    if (d.travelTimesAt != null && d.travelTimesAt > staleBefore) continue;
    withData.push({
      id: doc.id,
      latitude: d.latitude,
      longitude: d.longitude,
      job_id: d.jobId,
      user_id: jobUserMap.get(d.jobId) ?? null,
      _travelTimesAt: d.travelTimesAt ?? null,
      _createdAt: d.createdAt ?? 0,
    });
  }

  withData.sort((a, b) => {
    // Never-computed (null) first.
    if (a._travelTimesAt == null && b._travelTimesAt != null) return -1;
    if (a._travelTimesAt != null && b._travelTimesAt == null) return 1;
    if (a._travelTimesAt != null && b._travelTimesAt != null) {
      if (a._travelTimesAt !== b._travelTimesAt) return a._travelTimesAt - b._travelTimesAt;
    }
    // Then by createdAt descending.
    return (b._createdAt || 0) - (a._createdAt || 0);
  });

  return withData.slice(0, safeLimit).map(({ _travelTimesAt: _a, _createdAt: _b, ...row }) => row); // eslint-disable-line no-unused-vars
};

// ───────────────────────────── map ───────────────────────────────────────

/** Firestore caps an `in` filter at 30 values. */
const IN_FILTER_LIMIT = 30;

export const getListingsForMap = async ({ jobId, userId = null } = {}) => {
  const allowedJobIds = await accessibleJobIds(userId);

  // Only this user's live listings. Reading the whole collection and scoping in memory cost one
  // read per stored listing of every user, deleted and inactive ones included.
  const scopedJobIds = [...allowedJobIds].filter((id) => !jobId || id === jobId);
  const docs = [];
  for (let i = 0; i < scopedJobIds.length; i += IN_FILTER_LIMIT) {
    const chunk = await listingsCol()
      .where('jobId', 'in', scopedJobIds.slice(i, i + IN_FILTER_LIMIT))
      .where('isActive', '==', true)
      .where('manuallyDeleted', '==', false)
      .get();
    docs.push(...chunk.docs);
  }
  const snap = { docs };

  // Build job name map for the response.
  const jobSnap = await jobsCol().get();
  const jobMap = new Map();
  for (const doc of jobSnap.docs) {
    const d = doc.data();
    jobMap.set(doc.id, { name: d.name ?? null, dealType: d.dealType ?? null });
  }

  const listings = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    // Must be active, non-deleted, with valid coords.
    if (!d.isActive || d.manuallyDeleted) continue;
    if (!hasValidCoords(d)) continue;
    // User scoping.
    if (!allowedJobIds.has(d.jobId)) continue;

    const jobInfo = jobMap.get(d.jobId) ?? {};
    listings.push({
      id: doc.id,
      title: d.title ?? null,
      price: d.price ?? null,
      size: d.size ?? null,
      rooms: d.rooms ?? null,
      address: d.address ?? null,
      link: d.link ?? null,
      image_url: d.imageUrl ?? null,
      provider: d.provider ?? null,
      latitude: d.latitude,
      longitude: d.longitude,
      job_id: d.jobId,
      job_name: jobInfo.name ?? null,
      dealType: jobInfo.dealType ?? null,
    });
  }

  return { listings: await attachTravelTimes(listings) };
};

// ───────────────────────────── KPI aggregates ────────────────────────────

export const getListingsKpisForJobIds = async (jobIds = []) => {
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return { numberOfActiveListings: 0, medianPriceOfListings: 0 };
  }

  // Fetch all non-deleted listings for the given jobs.
  const allDocs = [];
  for (const jobId of jobIds) {
    const snap = await listingsCol().where('jobId', '==', jobId).where('manuallyDeleted', '==', false).get();
    allDocs.push(...snap.docs);
  }

  let activeCount = 0;
  const prices = [];

  for (const doc of allDocs) {
    const d = doc.data();
    if (d.isActive) activeCount++;
    if (d.price != null) prices.push(Number(d.price));
  }

  let medianPrice = 0;
  if (prices.length > 0) {
    prices.sort((a, b) => a - b);
    const n = prices.length;
    if (n % 2 === 1) {
      medianPrice = prices[Math.floor(n / 2)];
    } else {
      medianPrice = (prices[n / 2 - 1] + prices[n / 2]) / 2;
    }
  }

  return {
    numberOfActiveListings: activeCount,
    medianPriceOfListings: medianPrice,
  };
};

// ───────────────────────────── per-day buckets ───────────────────────────

export const getListingsPerDayForJobIds = async (jobIds = [], days = 14, now = Date.now()) => {
  const span = Number.isFinite(days) && days > 0 ? Math.floor(days) : 14;

  // Build the empty calendar.
  const buckets = new Map();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  for (let offset = span - 1; offset >= 0; offset--) {
    const day = new Date(startOfToday);
    day.setDate(day.getDate() - offset);
    buckets.set(toDayKey(day), 0);
  }

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return [...buckets].map(([date, count]) => ({ date, count }));
  }

  const from = new Date(startOfToday);
  from.setDate(from.getDate() - (span - 1));
  const fromMs = from.getTime();

  for (const jobId of jobIds) {
    const snap = await listingsCol().where('jobId', '==', jobId).where('manuallyDeleted', '==', false).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const createdAt = d.createdAt;
      if (createdAt == null || createdAt < fromMs) continue;
      const key = toDayKey(new Date(Number(createdAt)));
      if (buckets.has(key)) {
        buckets.set(key, buckets.get(key) + 1);
      }
    }
  }

  return [...buckets].map(([date, count]) => ({ date, count }));
};

// ───────────────────────────── provider distribution ─────────────────────

export const getProviderDistributionForJobIds = async (jobIds = []) => {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return [];

  const counts = new Map();
  let total = 0;

  for (const jobId of jobIds) {
    const snap = await listingsCol().where('jobId', '==', jobId).where('manuallyDeleted', '==', false).get();
    for (const doc of snap.docs) {
      const provider = doc.data().provider;
      if (provider) {
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
        total++;
      }
    }
  }

  if (total === 0) return [];

  // Sort by count descending.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const percentages = sorted.map(([type, cnt]) => ({
    type,
    value: Math.round((cnt / total) * 100),
  }));

  // Adjust rounding drift to keep sum at 100.
  const drift = 100 - percentages.reduce((s, p) => s + p.value, 0);
  if (drift !== 0 && percentages.length > 0) {
    let maxIdx = 0;
    for (let i = 1; i < percentages.length; i++) {
      if (percentages[i].value > percentages[maxIdx].value) maxIdx = i;
    }
    percentages[maxIdx].value = Math.max(0, percentages[maxIdx].value + drift);
  }

  return percentages;
};

// ───────────────────────────── available providers ───────────────────────

/**
 * Return every provider id stored in listings for system maintenance.
 *
 * This deliberately has no user argument and must not be exposed through product routes. It exists
 * for startup cleanup, where discovering obsolete providers requires the global inventory.
 * @returns {Promise<string[]>}
 */
export const getStoredProviderIdsForSystem = async () => {
  const snapshot = await listingsCol().get();
  return [
    ...new Set(
      snapshot.docs
        .map((doc) => doc.data().provider)
        .filter((provider) => typeof provider === 'string' && provider.length > 0),
    ),
  ].sort();
};
/**
 * The providers the user's listings come from, for the provider filter on Home.
 *
 * Firestore has no "distinct" query, so instead of reading every listing this asks one cheap
 * existence question per (job, provider) pair: does this job have at least one listing from this
 * provider with the requested soft-delete flag? The candidates are the providers each job is
 * configured with, which is where its listings come from; a provider dropped from a job stops being
 * offered as a filter even if old listings from it remain.
 *
 * @param {{ jobId?: string|null, jobName?: string|null, userId?: string|null, hiddenOnly?: boolean }} [options]
 * @returns {Promise<string[]>} Sorted provider ids.
 */
export const getAvailableProviders = async ({
  jobId = null,
  jobName = null,
  userId = null,
  hiddenOnly = false,
} = {}) => {
  const allowedJobIds = await accessibleJobIds(userId);
  const jobIdNeedle = jobId && String(jobId).trim().length > 0 ? String(jobId).trim() : null;
  const jobNameNeedle = jobName && String(jobName).trim().length > 0 ? String(jobName).trim() : null;

  const jobSnap = await jobsCol().get();
  const candidates = [];
  for (const doc of jobSnap.docs) {
    if (!allowedJobIds.has(doc.id)) continue;
    if (jobIdNeedle && doc.id !== jobIdNeedle) continue;
    const job = doc.data();
    if (jobNameNeedle && job.name !== jobNameNeedle) continue;
    const providerIds = Array.isArray(job.provider) ? job.provider.map((entry) => entry?.id) : [];
    for (const providerId of new Set(providerIds.filter((id) => typeof id === 'string' && id.length > 0))) {
      candidates.push({ jobId: doc.id, providerId });
    }
  }

  const providers = new Set();
  await Promise.all(
    candidates.map(async ({ jobId: candidateJobId, providerId }) => {
      if (providers.has(providerId)) return;
      const snapshot = await listingsCol()
        .where('jobId', '==', candidateJobId)
        .where('provider', '==', providerId)
        .where('manuallyDeleted', '==', hiddenOnly === true)
        .limit(1)
        .get();
      if (!snapshot.empty) providers.add(providerId);
    }),
  );

  return [...providers].sort();
};

// ───────────────────────────── connectivity ──────────────────────────────

export const getListingsToEnrichConnectivity = async ({ limit, maxAgeDays, now = Date.now() }) => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
  const staleBefore = now - Math.max(1, Number(maxAgeDays) || 1) * 24 * 60 * 60 * 1000;
  const base = (field, operator, value) =>
    listingsCol()
      .where('isActive', '==', true)
      .where('manuallyDeleted', '==', false)
      .where(field, operator, value)
      .limit(safeLimit);

  const [neverChecked, stale] = await Promise.all([
    base('connectivityCheckedAt', '==', null).get(),
    base('connectivityCheckedAt', '<', staleBefore).get(),
  ]);
  const docsById = new Map();
  for (const doc of [...neverChecked.docs, ...stale.docs]) {
    if (!docsById.has(doc.id)) docsById.set(doc.id, doc);
  }

  const results = [];
  for (const doc of docsById.values()) {
    const d = doc.data();
    if (!hasValidCoords(d)) continue;
    const checkedAt = d.connectivityCheckedAt ?? null;
    results.push({
      id: doc.id,
      latitude: d.latitude,
      longitude: d.longitude,
      provider: d.provider ?? null,
      _checkedAt: checkedAt,
      _createdAt: d.createdAt ?? 0,
    });
  }

  // Sort: never-checked first, then by createdAt descending.
  results.sort((a, b) => {
    if (a._checkedAt == null && b._checkedAt != null) return -1;
    if (a._checkedAt != null && b._checkedAt == null) return 1;
    return (b._createdAt || 0) - (a._createdAt || 0);
  });

  return results.slice(0, safeLimit).map(({ _checkedAt: _a, _createdAt: _b, ...row }) => row); // eslint-disable-line no-unused-vars
};

export const updateListingConnectivity = async (id, connectivity, columns, checkedAt = Date.now()) => {
  await listingsCol()
    .doc(id)
    .update({
      connectivity: connectivity == null ? null : JSON.stringify(connectivity),
      connectivityMaxDown: columns.maxDown ?? null,
      connectivityFiber: columns.fiber ?? null,
      connectivityMobileBits: columns.mobile ?? null,
      connectivityCheckedAt: checkedAt,
    });
};
