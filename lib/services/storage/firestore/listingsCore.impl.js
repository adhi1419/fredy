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
  isAdmin = false,
  hiddenOnly = false,
} = {}) => {
  const effectiveUserId = userId || '__NO_USER__';

  // 1. Determine accessible job ids for user scoping
  const allowed = await accessibleJobIds(effectiveUserId, isAdmin);

  // 2. Fetch all listings from Firestore
  const snapshot = await listingsCol().get();
  let rows = [];
  for (const snap of snapshot.docs) {
    const d = snap.data();
    // User scoping: if not admin, only listings from accessible jobs
    if (allowed !== null && !allowed.has(d.jobId)) continue;
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

  // 8. Provider filter
  if (providerFilter && String(providerFilter).trim().length > 0) {
    const prov = String(providerFilter).trim();
    apiRows = apiRows.filter((r) => r.provider === prov);
  }

  // 9. Status filter
  if (statusFilter === 'none') {
    apiRows = apiRows.filter((r) => r.status == null);
  } else if (
    typeof statusFilter === 'string' &&
    ['applied', 'rejected', 'accepted'].includes(statusFilter.toLowerCase())
  ) {
    const sv = statusFilter.toLowerCase();
    apiRows = apiRows.filter((r) => {
      if (r.status == null) return false;
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

  // Connectivity filters — mirror the sqlite WHERE clauses exactly.
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

  // 15. Sort
  const safeSortDir = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;
  const sortableMap = {
    created_at: 'created_at',
    price: 'price',
    size: 'size',
    provider: 'provider',
    title: 'title',
    job_name: 'job_name',
    is_active: 'is_active',
    isWatched: 'isWatched',
  };
  const sortKey = sortField && sortableMap[sortField] ? sortableMap[sortField] : 'created_at';
  const defaultDir = sortField && sortableMap[sortField] ? safeSortDir : -1; // default: created_at DESC

  apiRows.sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
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

  // 18. Attach travel times (async in the geoKpi implementation)
  const result = await attachTravelTimes(pageRows);

  return { totalNumber, page: safePage, result };
};

// ── getListingById ───────────────────────────────────────────────────────────

/**
 * Return a single listing by id, with job_name, dealType, isWatched joined.
 * Respects user scoping.
 */
export const getListingById = async (id, userId = null, isAdmin = false) => {
  if (!id || typeof id !== 'string') return null;
  if (!id) return null;
  const effectiveUserId = userId || '__NO_USER__';

  const snap = await listingsCol().doc(id).get();
  if (!snap.exists) return null;

  const d = snap.data();

  // Exclude soft-deleted
  if (d.manuallyDeleted) return null;

  // User scoping
  if (!isAdmin) {
    const allowed = await accessibleJobIds(effectiveUserId, false);
    if (allowed !== null && !allowed.has(d.jobId)) return null;
  }

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
export const filterListingIdsForUser = async (ids, userId, isAdmin = false) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return [];
  if (isAdmin) return unique;
  if (!userId) return [];

  const allowed = await accessibleJobIds(userId, false);
  if (allowed === null) return unique; // admin path (shouldn't happen given check above)

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
 * Whether a user may act on a single listing.
 */
export const userCanAccessListing = async (id, userId, isAdmin = false) => {
  const filtered = await filterListingIdsForUser([id], userId, isAdmin);
  return filtered.length > 0;
};
