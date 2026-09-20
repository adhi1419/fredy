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
import { paginate } from './collections.js';

// ── queryListings ────────────────────────────────────────────────────────────

/**
 * Query listings with pagination, filtering and sorting.
 * Fetches all non-hard-deleted listings scoped to the user, then filters/sorts/paginates in memory.
 */
export const queryListings = async ({
  pageSize = 50,
  page = 1,
  freeTextFilter,
  activityFilter,
  jobNameFilter,
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
  userId = null,
  hiddenOnly = false,
} = {}) => {
  const effectiveUserId = userId || '__NO_USER__';

  // 1. Determine accessible job ids for user scoping
  const allowed = await accessibleJobIds(effectiveUserId);

  // 2. Fetch all listings from Firestore
  const snapshot = await listingsCol().get();
  let rows = [];
  for (const snap of snapshot.docs) {
    const d = snap.data();
    // User scoping: only listings from accessible jobs
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

  // 6. Activity filter
  if (activityFilter === true) {
    apiRows = apiRows.filter((r) => r.is_active === 1);
  } else if (activityFilter === false) {
    apiRows = apiRows.filter((r) => r.is_active === 0);
  }

  // 7. Job ID / job name filter
  if (jobIdFilter && String(jobIdFilter).trim().length > 0) {
    const jid = String(jobIdFilter).trim();
    apiRows = apiRows.filter((r) => r.job_id === jid);
  } else if (jobNameFilter && String(jobNameFilter).trim().length > 0) {
    // Would need a job name lookup — skip for now (not tested in core contract)
  }

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

  // Batch-fetch watch list for user
  for (const row of apiRows) {
    const job = jobMap.get(row.job_id);
    row.job_name = job?.name ?? null;
    row.dealType = job?.dealType ?? null;

    // isWatched
    const wDocId = watchDocId(row.id, effectiveUserId);
    const wDoc = await watchCol().doc(wDocId).get();
    row.isWatched = wDoc.exists ? 1 : 0;
  }

  // 14. Watch list filter
  if (watchListFilter === true) {
    apiRows = apiRows.filter((r) => r.isWatched === 1);
  } else if (watchListFilter === false) {
    apiRows = apiRows.filter((r) => r.isWatched === 0);
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
  if (docIds.length === 0) return;

  if (hardDelete) {
    const db = FirestoreConnection.getConnection();
    for (const docId of docIds) {
      await db.recursiveDelete(listingsCol().doc(docId));
    }
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

  for (const doc of snapshot.docs) {
    const d = doc.data();
    // Only hard-delete listings explicitly marked inactive (isActive === false).
    // Keep active (true) and unknown (null/undefined).
    if (d.isActive === false) {
      await db.recursiveDelete(listingsCol().doc(doc.id));
    }
  }
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
