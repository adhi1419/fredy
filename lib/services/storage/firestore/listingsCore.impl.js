/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsCore.impl.js — Core listing query, delete, restore, and access control
 * for the Firestore backend.
 *
 * Strategy: equality-scoped Firestore fetch + in-memory filter/sort/paginate.
 */

import FirestoreConnection from './FirestoreConnection.js';
import { batched, BATCH_LIMIT, watchDocId } from './collections.js';
import { listingsCol, jobsCol, watchCol, toApiRow, parseListingStatus, accessibleJobIds } from './listingsShared.js';
import { attachTravelTimes } from './listingsGeoKpi.impl.js';
import { deleteDeliveriesForJobId, deleteDeliveriesForListingIds } from './notificationLedgerStorage.js';
import { paginate } from './collections.js';
import { forgetKnownListingIds } from './knownListingIndex.js';

// ── queryListings ────────────────────────────────────────────────────────────

/**
 * Query listings with pagination, filtering and sorting.
 * Fetches all non-hard-deleted listings scoped to the user, then filters/sorts/paginates in memory.
 *
 * @param {{west: number, south: number, east: number, north: number} | null} [bbox] Map bounding
 *   box (WGS84, longitude first). When set, only rows with finite coordinates inside the box
 *   (inclusive) are kept; rows without coordinates are excluded.
 * @param {string[] | null} [idsFilter] When a non-empty array, keep only rows whose `id` is in the
 *   set. Applied as a filter step before sorting and pagination, so it composes with every other
 *   filter and with `pins` mode. Empty or null means no restriction.
 * @param {boolean} [pins] Map-pin mode. When true, every filter applies exactly as in the paginated
 *   mode, but pagination, sorting, travel-time hydration and the per-row affordability verdict are
 *   skipped, and the function returns early with `{ totalNumber, pins }`. `totalNumber` is still the
 *   count of ALL matching rows (the same number the paginated mode reports); `pins` contains only
 *   rows with finite latitude AND longitude, each projected to
 *   `{ id, latitude, longitude, title, price, provider }`.
 */
export const queryListings = async ({
  pageSize = 50,
  page = 1,
  freeTextFilter,
  activityFilter,
  jobIdFilter,
  providerFilter,
  watchListFilter,
  statusFilter,
  sortField = null,
  sortDir = 'asc',
  createdAfter = null,
  createdBefore = null,
  minPrice = null,
  maxPrice = null,
  connectivityMinDown = null,
  connectivityFiberOnly = false,
  connectivityMobileMask = null,
  bbox = null,
  idsFilter = null,
  pins = false,
  userId = null,
  hiddenOnly = false,
} = {}) => {
  const effectiveUserId = userId || '__NO_USER__';

  // 1. Determine accessible job ids for user scoping
  const allowed = await accessibleJobIds(effectiveUserId);
  const jobIdNeedle = jobIdFilter && String(jobIdFilter).trim().length > 0 ? String(jobIdFilter).trim() : null;
  const scopedJobIds = [...allowed].filter((jobId) => jobIdNeedle == null || jobId === jobIdNeedle);

  // 2. Fetch only this user's listings, already narrowed by the filters Firestore can apply. Reading
  // the whole collection and scoping in memory cost one read per stored listing of every user,
  // soft-deleted ones included, on every Home load.
  const snapshots = await queryScopedListings(scopedJobIds, {
    manuallyDeleted: hiddenOnly === true,
    lifecycleState: lifecycleStateForFilter(statusFilter),
  });
  let rows = [];
  for (const snap of snapshots) {
    const d = snap.data();
    // User scoping stays as a guard behind the query.
    if (!allowed.has(d.jobId)) continue;
    rows.push({ snap, d });
  }

  // 3. Convert to API rows
  let apiRows = rows.map(({ snap, d }) => {
    const row = toApiRow(snap);
    // Carry raw doc data for filtering
    row._raw = d;
    return row;
  });

  // 4. Filter: hiddenOnly vs visible
  if (hiddenOnly) {
    apiRows = apiRows.filter((r) => r.manually_deleted === 1);
  } else {
    apiRows = apiRows.filter((r) => r.manually_deleted === 0);
  }

  // 5. Free text filter (title, address, provider, link — case insensitive)
  if (freeTextFilter && String(freeTextFilter).trim().length > 0) {
    const needle = String(freeTextFilter).trim().toLowerCase();
    apiRows = apiRows.filter((r) => {
      const haystack = [r.title, r.address, r.provider, r.link]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    });
  }

  // 5b. Map bounding-box filter. A row is in the area only if it has finite coordinates that fall
  // inside the box (edges inclusive). Rows with no coordinates cannot be placed on the map, so a
  // set box excludes them rather than keeping them with the located rows.
  if (bbox) {
    apiRows = apiRows.filter((r) => {
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      return lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;
    });
  }

  // 5c. Explicit id filter. When a non-empty set of ids is supplied (e.g. a map-pin selection
  // narrowing the paginated list to specific listings), keep only those rows. An empty or absent
  // set is no restriction. ANDs with every other filter, including bbox and pins mode.
  if (Array.isArray(idsFilter) && idsFilter.length > 0) {
    const idSet = new Set(idsFilter.map((id) => String(id)));
    apiRows = apiRows.filter((r) => idSet.has(String(r.id)));
  }

  // 6. Activity filter
  if (activityFilter === true) {
    apiRows = apiRows.filter((r) => r.is_active === 1);
  } else if (activityFilter === false) {
    apiRows = apiRows.filter((r) => r.is_active === 0);
  }

  // 7. Job ID filter: applied by the query above. A job-name filter would need a job lookup and is
  // not part of the core contract.

  // 8. Provider filter. The API keeps the original scalar contract and additionally accepts the
  // repeated/comma-separated form used by Home's multi-select.
  const providerIds = normalizeProviderFilter(providerFilter);
  if (providerIds.length > 0) {
    apiRows = apiRows.filter((r) => providerIds.includes(r.provider));
  }

  // 9. Status filter. New clients filter the canonical lifecycle; old status
  // names remain queryable through the compatibility projection.
  if (statusFilter === 'none' || statusFilter === 'new') {
    apiRows = apiRows.filter((r) => r.lifecycle?.state === 'new');
  } else if (
    typeof statusFilter === 'string' &&
    ['viewed', 'viewing', 'archived'].includes(statusFilter.toLowerCase())
  ) {
    const state = statusFilter.toLowerCase() === 'viewing' ? 'viewed' : statusFilter.toLowerCase();
    apiRows = apiRows.filter((r) => r.lifecycle?.state === state);
  } else if (
    typeof statusFilter === 'string' &&
    ['applied', 'rejected', 'accepted'].includes(statusFilter.toLowerCase())
  ) {
    const sv = statusFilter.toLowerCase();
    apiRows = apiRows.filter((r) => {
      if (sv === 'applied' && r.lifecycle?.state === 'applied') return true;
      const parsed =
        typeof r.status === 'string'
          ? (() => {
              try {
                return JSON.parse(r.status);
              } catch {
                return null;
              }
            })()
          : r.status;
      return parsed?.status === sv;
    });
  }

  // 10. Time range
  if (Number.isFinite(createdAfter) && createdAfter > 0) {
    apiRows = apiRows.filter((r) => r.created_at >= createdAfter);
  }
  if (Number.isFinite(createdBefore) && createdBefore > 0) {
    apiRows = apiRows.filter((r) => r.created_at <= createdBefore);
  }

  // 11. Price range
  if (Number.isFinite(minPrice) && minPrice >= 0) {
    apiRows = apiRows.filter((r) => r.price >= minPrice);
  }
  if (Number.isFinite(maxPrice) && maxPrice >= 0) {
    apiRows = apiRows.filter((r) => r.price <= maxPrice);
  }

  // Apply connectivity filters to the fetched API rows.
  if (Number.isFinite(connectivityMinDown) && connectivityMinDown > 0) {
    const min = Math.floor(connectivityMinDown);
    apiRows = apiRows.filter((r) => r.connectivity_max_down != null && r.connectivity_max_down >= min);
  }
  if (connectivityFiberOnly === true) {
    apiRows = apiRows.filter((r) => r.connectivity_fiber === 1 || r.connectivity_fiber === true);
  }
  if (Number.isFinite(connectivityMobileMask) && connectivityMobileMask > 0) {
    apiRows = apiRows.filter(
      (r) => r.connectivity_mobile != null && (Number(r.connectivity_mobile) & connectivityMobileMask) !== 0,
    );
  }

  // 12. Parse status
  apiRows = apiRows.map(parseListingStatus);

  // 13. Attach job_name, dealType, isWatched
  // Batch-fetch jobs
  const jobIds = [...new Set(apiRows.map((r) => r.job_id).filter(Boolean))];
  const jobMap = new Map();
  for (const jid of jobIds) {
    const jobDoc = await jobsCol().doc(jid).get();
    if (jobDoc.exists) {
      const jd = jobDoc.data();
      jobMap.set(jid, { name: jd.name ?? null, dealType: jd.dealType ?? null });
    }
  }

  // Watch list: one query for the user's entries instead of one document lookup per row. A lookup of
  // a missing document is billed as a read, and most listings are not watched.
  const watchedIds = new Set();
  if (apiRows.length > 0) {
    const watchSnapshot = await watchCol().where('userId', '==', effectiveUserId).get();
    for (const doc of watchSnapshot.docs) {
      const listingId = doc.data().listingId;
      if (listingId) watchedIds.add(listingId);
    }
  }
  for (const row of apiRows) {
    const job = jobMap.get(row.job_id);
    row.job_name = job?.name ?? null;
    row.dealType = job?.dealType ?? null;
    row.isWatched = watchedIds.has(row.id) ? 1 : 0;
  }

  // 14. Watch list filter
  if (watchListFilter === true) {
    apiRows = apiRows.filter((r) => r.isWatched === 1);
  } else if (watchListFilter === false) {
    apiRows = apiRows.filter((r) => r.isWatched === 0);
  }

  // Map-pin mode. All filters above have been applied, so this is the full matching set. Return
  // early — before sorting, pagination, travel-time hydration and the per-row verdict, none of
  // which a map of pins needs. totalNumber stays the count of every matching row (identical to the
  // paginated mode); pins carries only rows that can actually be placed on the map.
  if (pins) {
    const totalNumber = apiRows.length;
    const isFiniteCoord = (v) => typeof v === 'number' && Number.isFinite(v);
    const pinRows = apiRows
      .filter((r) => isFiniteCoord(r.latitude) && isFiniteCoord(r.longitude))
      .map((r) => ({
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        title: r.title,
        price: r.price,
        provider: r.provider,
      }));
    return { totalNumber, pins: pinRows };
  }

  // Travel time lives in a subcollection, so only the travel-time sort needs to hydrate every
  // candidate before pagination. Other views keep the existing page-sized enrichment cost.
  const needsTravelTimeSort = sortField === 'travel_time';
  if (needsTravelTimeSort) {
    await attachTravelTimes(apiRows);
  }

  // 15. Sort
  const safeSortDir = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;
  const sortableFields = new Set([
    'created_at',
    'price',
    'size',
    'provider',
    'title',
    'job_name',
    'is_active',
    'isWatched',
    'distance',
    'travel_time',
  ]);
  const sortKey = sortableFields.has(sortField) ? sortField : 'created_at';
  const defaultDir = sortableFields.has(sortField) ? safeSortDir : -1; // default: created_at DESC

  apiRows.sort((a, b) => {
    const va = listingSortValue(a, sortKey);
    const vb = listingSortValue(b, sortKey);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * defaultDir;
    return (va - vb) * defaultDir;
  });

  // 16. Paginate
  const totalNumber = apiRows.length;
  const { pageRows, safePage } = paginate(apiRows, page, pageSize);

  // 17. Clean up internal fields
  for (const row of pageRows) {
    delete row._raw;
  }

  // 18. Attach travel times (async in the geoKpi implementation). A travel-time sort already
  // hydrated the full candidate set, so do not issue a second read for the page.
  const result = needsTravelTimeSort ? pageRows : await attachTravelTimes(pageRows);

  return { totalNumber, page: safePage, result };
};

/**
 * The canonical lifecycle state a status filter selects, so the query can narrow on it, or null when
 * the filter is absent or matches on something other than the lifecycle state.
 *
 * @param {unknown} statusFilter
 * @returns {string|null}
 */
export function lifecycleStateForFilter(statusFilter) {
  if (typeof statusFilter !== 'string') return null;
  const value = statusFilter.toLowerCase();
  if (value === 'none' || value === 'new') return 'new';
  if (value === 'viewing') return 'viewed';
  if (['viewed', 'archived', 'applied'].includes(value)) return value;
  return null;
}

/** Firestore caps an `in` filter at 30 values. */
const IN_FILTER_LIMIT = 30;

/**
 * Every listing of the given jobs with the given soft-delete flag, optionally in one lifecycle
 * state. Equality filters only, so Firestore serves it by merging single-field indexes and needs no
 * composite index.
 *
 * @param {string[]} jobIds
 * @param {{ manuallyDeleted: boolean, lifecycleState: string|null }} filters
 * @returns {Promise<import('@google-cloud/firestore').QueryDocumentSnapshot[]>}
 */
async function queryScopedListings(jobIds, { manuallyDeleted, lifecycleState }) {
  const docs = [];
  for (let i = 0; i < jobIds.length; i += IN_FILTER_LIMIT) {
    let query = listingsCol()
      .where('jobId', 'in', jobIds.slice(i, i + IN_FILTER_LIMIT))
      .where('manuallyDeleted', '==', manuallyDeleted);
    if (lifecycleState != null) query = query.where('lifecycle.state', '==', lifecycleState);
    const snapshot = await query.get();
    docs.push(...snapshot.docs);
  }
  return docs;
}

export function normalizeProviderFilter(value) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .flatMap((entry) => String(entry ?? '').split(','))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function minimumNumber(values) {
  const numbers = values
    .filter((value) => value != null && value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.min(...numbers) : null;
}

function minimumDistance(listing) {
  const distances = Array.isArray(listing.distances) ? listing.distances : [];
  return minimumNumber(distances.map((entry) => entry?.meters ?? entry?.distanceMeters));
}

function minimumTravelTime(listing) {
  const travelTimes = Array.isArray(listing.travelTimes) ? listing.travelTimes : [];
  return minimumNumber(
    travelTimes.flatMap((entry) =>
      Object.values(entry ?? {})
        .filter((mode) => mode && typeof mode === 'object')
        .map((mode) => mode.minutes),
    ),
  );
}

function listingSortValue(listing, sortKey) {
  if (sortKey === 'distance') return minimumDistance(listing);
  if (sortKey === 'travel_time') return minimumTravelTime(listing);
  return listing[sortKey];
}

// ── getListingById ───────────────────────────────────────────────────────────

/**
 * Return a single listing by id, with job_name, dealType, isWatched joined.
 * Respects user scoping.
 */
export const getListingById = async (id, userId = null) => {
  if (!id || typeof id !== 'string') return null;
  if (!id) return null;
  const effectiveUserId = userId || '__NO_USER__';

  const snap = await listingsCol().doc(id).get();
  if (!snap.exists) return null;

  const d = snap.data();

  // Exclude soft-deleted
  if (d.manuallyDeleted) return null;

  // User scoping
  const allowed = await accessibleJobIds(effectiveUserId);
  if (!allowed.has(d.jobId)) return null;

  let row = toApiRow(snap);
  row = parseListingStatus(row);

  // Join job_name + dealType
  if (d.jobId) {
    const jobDoc = await jobsCol().doc(d.jobId).get();
    if (jobDoc.exists) {
      const jd = jobDoc.data();
      row.job_name = jd.name ?? null;
      row.dealType = jd.dealType ?? null;
    } else {
      row.job_name = null;
      row.dealType = null;
    }
  } else {
    row.job_name = null;
    row.dealType = null;
  }

  // isWatched
  const wDocId = watchDocId(id, effectiveUserId);
  const wDoc = await watchCol().doc(wDocId).get();
  row.isWatched = wDoc.exists ? 1 : 0;

  // Attach travel times (identity stub for now)
  return (await attachTravelTimes([row], { includeGeometry: true }))[0];
};

// ── deleteListingsById (soft + hard) ─────────────────────────────────────────

/**
 * Soft-delete (set manuallyDeleted=true) or hard-delete listings by id.
 */
export const deleteListingsById = async (ids, hardDelete = false) => {
  if (!Array.isArray(ids) || ids.length === 0) return;

  if (hardDelete) {
    // Hard delete: remove doc + subcollections via recursiveDelete
    const db = FirestoreConnection.getConnection();
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const chunk = ids.slice(i, i + BATCH_LIMIT);
      for (const id of chunk) {
        const docRef = listingsCol().doc(id);
        await db.recursiveDelete(docRef);
      }
    }
    forgetKnownListingIds(ids);
    await deleteDeliveriesForListingIds(ids);
    return;
  }

  // Soft delete: set manuallyDeleted = true (tombstone)
  await batched(ids, (batch, id) => {
    batch.update(listingsCol().doc(id), { manuallyDeleted: true });
  });
};

// ── restoreListingsById ──────────────────────────────────────────────────────

/**
 * Restore soft-deleted listings by clearing the manuallyDeleted flag.
 */
export const restoreListingsById = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return;
  await batched(ids, (batch, id) => {
    batch.update(listingsCol().doc(id), { manuallyDeleted: false });
  });
};

// ── deleteListingsByJobId ────────────────────────────────────────────────────

/**
 * Soft or hard delete all listings for a job.
 */
export const deleteListingsByJobId = async (jobId, hardDelete = false) => {
  if (!jobId) return;
  const snapshot = await listingsCol().where('jobId', '==', jobId).get();
  const docIds = snapshot.docs.map((d) => d.id);
  if (docIds.length === 0) {
    if (hardDelete) await deleteDeliveriesForJobId(jobId);
    return;
  }

  if (hardDelete) {
    const db = FirestoreConnection.getConnection();
    for (const docId of docIds) {
      await db.recursiveDelete(listingsCol().doc(docId));
    }
    forgetKnownListingIds(docIds);
    await deleteDeliveriesForJobId(jobId);
    return;
  }

  await batched(docIds, (batch, docId) => {
    batch.update(listingsCol().doc(docId), { manuallyDeleted: true });
  });
};

// ── deleteInactiveListingsByJobId ────────────────────────────────────────────

/**
 * Hard-delete only inactive (isActive === false) listings for a job.
 * Listings with isActive === null (never determined) are kept.
 */
export const deleteInactiveListingsByJobId = async (jobId) => {
  if (!jobId) return;
  const snapshot = await listingsCol().where('jobId', '==', jobId).get();
  const db = FirestoreConnection.getConnection();
  const deletedIds = [];

  for (const doc of snapshot.docs) {
    const d = doc.data();
    // Only hard-delete listings explicitly marked inactive (isActive === false).
    // Keep active (true) and unknown (null/undefined).
    if (d.isActive === false) {
      await db.recursiveDelete(listingsCol().doc(doc.id));
      deletedIds.push(doc.id);
    }
  }
  forgetKnownListingIds(deletedIds);
  await deleteDeliveriesForListingIds(deletedIds);
};

// ── filterListingIdsForUser ──────────────────────────────────────────────────

/**
 * Reduce a list of listing ids to those the given user may act on.
 */
export const filterListingIdsForUser = async (ids, userId) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0 || !userId) return [];

  const allowed = await accessibleJobIds(userId);

  const result = [];
  for (let i = 0; i < unique.length; i += BATCH_LIMIT) {
    const chunk = unique.slice(i, i + BATCH_LIMIT);
    for (const id of chunk) {
      const snap = await listingsCol().doc(id).get();
      if (snap.exists && allowed.has(snap.data().jobId)) {
        result.push(id);
      }
    }
  }
  return result;
};

// ── userCanAccessListing ─────────────────────────────────────────────────────

/**
 * Whether a user owns the Saved Search that produced a listing.
 * Shared users can read the listing, but only the job owner may persist listing state.
 */
export const userCanModifyListing = async (id, userId) => {
  if (!id || !userId) return false;
  const listingSnap = await listingsCol().doc(id).get();
  if (!listingSnap.exists) return false;
  const jobId = listingSnap.data().jobId;
  if (!jobId) return false;
  const jobSnap = await jobsCol().doc(jobId).get();
  return jobSnap.exists && jobSnap.data().userId === userId;
};

/**
 * Reduce listing ids to rows whose Saved Search is owned by the given user.
 * This is intentionally separate from filterListingIdsForUser, which includes explicit shares for reads.
 */
export const filterListingIdsForOwner = async (ids, userId) => {
  if (!Array.isArray(ids) || ids.length === 0 || !userId) return [];
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  const result = [];
  const ownersByJobId = new Map();

  for (const id of unique) {
    const listingSnap = await listingsCol().doc(id).get();
    if (!listingSnap.exists) continue;
    const jobId = listingSnap.data().jobId;
    if (!jobId) continue;
    if (!ownersByJobId.has(jobId)) {
      const jobSnap = await jobsCol().doc(jobId).get();
      ownersByJobId.set(jobId, jobSnap.exists ? (jobSnap.data().userId ?? null) : null);
    }
    if (ownersByJobId.get(jobId) === userId) result.push(id);
  }
  return result;
};

/**
 * Whether a user may read a single listing.
 */
export const userCanAccessListing = async (id, userId) => {
  const filtered = await filterListingIdsForUser([id], userId);
  return filtered.length > 0;
};
