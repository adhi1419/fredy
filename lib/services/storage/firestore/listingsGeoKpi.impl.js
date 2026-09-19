/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsGeoKpi.impl.js — Firestore implementation of GEO / TRAVEL / KPI / CONNECTIVITY.
 *
 * All exports mirror the SQLite listingsStorage.js signatures 1:1.
 * Travel times live in a subcollection `listings/{id}/travel_times` with
 * DELETE-then-write replace semantics. KPI/median/per-day/distribution are
 * computed in memory after scoped Firestore fetches, replicating the SQLite
 * math exactly.
 */

import { listingsCol, jobsCol, accessibleJobIds } from './listingsShared.js';
import { batched } from './collections.js';
import { fromJson } from '../../../utils.js';

// ───────────────────────────── constants ──────────────────────────────────

export const TRAVEL_TIME_FAILURE_LIMIT = 5;

// ───────────────────────────── helpers ────────────────────────────────────

/** Valid geocoordinates: non-null and not the -1/-1 "geocoder found nothing" marker. */
function hasValidCoords(d) {
  return d.latitude != null && d.longitude != null && d.latitude !== -1 && d.longitude !== -1;
}

/** Local-time YYYY-MM-DD key for a date (mirrors SQLite toDayKey). */
function toDayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Turn one stored travel-time sub-doc into the shape the API and UI expect.
 * Mirrors the SQLite toTravelTimeEntry exactly (without geometry for list views).
 */
function toTravelTimeEntry(row) {
  const entry = {
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
  const rows = Array.isArray(entries) ? entries.filter((e) => e && typeof e.label === 'string') : [];

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
      const docRef = subCol.doc(row.label);
      batch.set(docRef, {
        label: row.label,
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

export const getListingsForMap = async ({ jobId, userId = null, isAdmin = false } = {}) => {
  const allowedJobIds = await accessibleJobIds(userId, isAdmin);

  let snap;
  if (jobId) {
    snap = await listingsCol().where('jobId', '==', jobId).get();
  } else {
    snap = await listingsCol().get();
  }

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
    if (allowedJobIds != null && !allowedJobIds.has(d.jobId)) continue;

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

export const getAvailableProviders = async ({
  jobId = null,
  jobName = null,
  userId = null,
  isAdmin = false,
  hiddenOnly = false,
} = {}) => {
  const allowedJobIds = await accessibleJobIds(userId, isAdmin);

  // Build job name -> id map if needed.
  let jobNameMap = null;
  if (jobName && String(jobName).trim().length > 0) {
    const jobSnap = await jobsCol().get();
    jobNameMap = new Map();
    for (const doc of jobSnap.docs) {
      jobNameMap.set(doc.data().name, doc.id);
    }
  }

  let snap;
  if (jobId && String(jobId).trim().length > 0) {
    snap = await listingsCol().where('jobId', '==', String(jobId).trim()).get();
  } else {
    snap = await listingsCol().get();
  }

  const providers = new Set();
  for (const doc of snap.docs) {
    const d = doc.data();
    // User scoping.
    if (allowedJobIds != null && !allowedJobIds.has(d.jobId)) continue;
    // Job name filter.
    if (jobNameMap && jobName) {
      const targetJobId = jobNameMap.get(String(jobName).trim());
      if (d.jobId !== targetJobId) continue;
    }
    // Hidden filter.
    if (hiddenOnly) {
      if (!d.manuallyDeleted) continue;
    } else {
      if (d.manuallyDeleted) continue;
    }
    if (d.provider) providers.add(d.provider);
  }

  return [...providers].sort();
};

// ───────────────────────────── connectivity ──────────────────────────────

export const getListingsToEnrichConnectivity = async ({ limit, maxAgeDays, now = Date.now() }) => {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
  const staleBefore = now - Math.max(1, Number(maxAgeDays) || 1) * 24 * 60 * 60 * 1000;

  const snap = await listingsCol().where('isActive', '==', true).where('manuallyDeleted', '==', false).get();

  const results = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!hasValidCoords(d)) continue;
    const checkedAt = d.connectivityCheckedAt ?? null;
    if (checkedAt != null && checkedAt >= staleBefore) continue;
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
