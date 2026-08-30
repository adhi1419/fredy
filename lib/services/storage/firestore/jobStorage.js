/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * jobStorage — Firestore implementation.
 *
 * Job docs store arrays/objects natively (no JSON string columns). The
 * numberOfFoundListings subquery becomes a count() aggregate; queryJobs
 * filtering/sorting/pagination happens in memory after the scoped fetch
 * (see doc/firestore-data-model.md).
 */

import { nanoid } from 'nanoid';
import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS, batched } from './collections.js';
import logger from '../../logger.js';
import { DEAL_TYPES } from '../../dealType.js';
import { getAllChannels } from './configuredAdapterStorage.js';

const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);
const listingsCol = () => FirestoreConnection.collection(COLLECTIONS.LISTINGS);
const watchCol = () => FirestoreConnection.collection(COLLECTIONS.WATCH_LIST);

const buildChannelMap = async () => new Map((await getAllChannels()).map((channel) => [channel.id, channel]));

const hydrateNotificationAdapter = (refs, channelMap) => {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((ref) => channelMap.get(ref?.configuredAdapterId))
    .filter(Boolean)
    .map((channel) => ({
      id: channel.adapterId,
      name: channel.name,
      fields: channel.fields,
      configuredAdapterId: channel.id,
    }));
};

async function numberOfFoundListings(jobId) {
  const agg = await listingsCol()
    .where('jobId', '==', jobId)
    .where('isActive', '==', true)
    .where('manuallyDeleted', '==', false)
    .count()
    .get();
  return agg.data().count;
}

async function toApiJob(snap, channelMap) {
  const d = snap.data();
  return {
    id: snap.id,
    userId: d.userId,
    enabled: !!d.enabled,
    name: d.name ?? null,
    blacklist: d.blacklist ?? [],
    provider: d.provider ?? [],
    shared_with_user: d.sharedWithUser ?? [],
    notificationAdapter: hydrateNotificationAdapter(d.notificationAdapter, channelMap),
    spatialFilter: d.spatialFilter ?? null,
    specFilter: d.specFilter ?? null,
    commuteFilter: d.commuteFilter ?? null,
    dealType: d.dealType ?? null,
    lastRunAt: d.lastRunAt ?? null,
    numberOfFoundListings: await numberOfFoundListings(snap.id),
  };
}

export const upsertJob = async ({
  jobId,
  name,
  blacklist = [],
  enabled = true,
  provider,
  notificationAdapter,
  userId,
  shareWithUsers = [],
  spatialFilter = null,
  specFilter = null,
  commuteFilter = null,
  dealType = null,
}) => {
  const id = jobId || nanoid();
  const ref = jobsCol().doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    // Owner is preserved on update; a missing dealType keeps the stored one.
    await ref.update({
      enabled: !!enabled,
      name: name ?? null,
      blacklist: blacklist ?? [],
      provider: provider ?? [],
      notificationAdapter: notificationAdapter ?? [],
      sharedWithUser: shareWithUsers ?? [],
      spatialFilter: spatialFilter ?? null,
      specFilter: specFilter ?? null,
      commuteFilter: commuteFilter ?? null,
      ...(dealType != null ? { dealType } : {}),
    });
  } else {
    await ref.set({
      userId,
      enabled: !!enabled,
      name: name ?? null,
      blacklist: blacklist ?? [],
      provider: provider ?? [],
      notificationAdapter: notificationAdapter ?? [],
      sharedWithUser: shareWithUsers ?? [],
      spatialFilter: spatialFilter ?? null,
      specFilter: specFilter ?? null,
      commuteFilter: commuteFilter ?? null,
      dealType: dealType ?? DEAL_TYPES.RENT,
      lastRunAt: null,
    });
  }
};

export const getJob = async (jobId) => {
  // Parity with sqlite: a missing/empty id is "no such row", not an error
  // (Firestore's .doc('') throws otherwise).
  if (!jobId || typeof jobId !== 'string') return null;
  const snap = await jobsCol().doc(jobId).get();
  if (!snap.exists) return null;
  const channelMap = await buildChannelMap();
  return toApiJob(snap, channelMap);
};

export const updateJobLastRunAt = async (jobId, timestamp) => {
  await jobsCol().doc(jobId).update({ lastRunAt: timestamp });
};

export const setJobStatus = async ({ jobId, status }) => {
  await jobsCol().doc(jobId).update({ enabled: !!status });
};

/**
 * Cascade delete every listing of a job: listing docs (with their
 * travel_times / price_history subcollections) and their watch entries.
 * Exported for reuse by user cascade.
 */
export const deleteListingsCascadeByJobId = async (jobId) => {
  const db = FirestoreConnection.getConnection();
  const snapshot = await listingsCol().where('jobId', '==', jobId).get();
  for (const doc of snapshot.docs) {
    // recursiveDelete removes the doc and its subcollections.
    await db.recursiveDelete(doc.ref);
  }
  const listingIds = new Set(snapshot.docs.map((d) => d.id));
  if (listingIds.size > 0) {
    const watchSnapshot = await watchCol().get();
    const toDelete = watchSnapshot.docs.filter((d) => listingIds.has(d.data().listingId));
    await batched(toDelete, (batch, d) => batch.delete(d.ref));
  }
};

export const removeJob = async (jobId) => {
  await deleteListingsCascadeByJobId(jobId);
  await jobsCol().doc(jobId).delete();
};

export const removeJobsByUserId = async (userId) => {
  const snapshot = await jobsCol().where('userId', '==', userId).get();
  for (const doc of snapshot.docs) {
    await removeJob(doc.id);
  }
  if (snapshot.size > 0) {
    logger.info(`Removed ${snapshot.size} jobs for user ${userId}`);
  }
};

const byNameNullsLast = (a, b) => {
  if (a.name == null && b.name == null) return 0;
  if (a.name == null) return 1;
  if (b.name == null) return -1;
  return String(a.name).localeCompare(String(b.name));
};

export const getJobs = async ({ includeDisabled = false } = {}) => {
  let query = jobsCol();
  if (!includeDisabled) query = query.where('enabled', '==', true);
  const snapshot = await query.get();
  const channelMap = await buildChannelMap();
  const jobs = await Promise.all(snapshot.docs.map((snap) => toApiJob(snap, channelMap)));
  return jobs.sort(byNameNullsLast);
};

export const queryJobs = async ({
  pageSize = 50,
  page = 1,
  activityFilter,
  freeTextFilter,
  sortField = null,
  sortDir = 'asc',
  userId = null,
  isAdmin = false,
} = {}) => {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(1000, Math.floor(pageSize)) : 50;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const snapshot = await jobsCol().get();
  const channelMap = await buildChannelMap();
  let jobs = await Promise.all(snapshot.docs.map((snap) => toApiJob(snap, channelMap)));

  const effectiveUserId = userId || '__NO_USER__';
  if (!isAdmin) {
    jobs = jobs.filter((j) => j.userId === effectiveUserId || (j.shared_with_user ?? []).includes(effectiveUserId));
  }
  if (freeTextFilter && String(freeTextFilter).trim().length > 0) {
    const needle = String(freeTextFilter).trim().toLowerCase();
    jobs = jobs.filter((j) =>
      String(j.name ?? '')
        .toLowerCase()
        .includes(needle),
    );
  }
  if (activityFilter === true) {
    jobs = jobs.filter((j) => j.enabled);
  } else if (activityFilter === false) {
    jobs = jobs.filter((j) => !j.enabled);
  }

  const totalNumber = jobs.length;

  const sortable = new Set(['name', 'numberOfFoundListings', 'enabled']);
  const safeSortField = sortField && sortable.has(sortField) ? sortField : null;
  const dir = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;
  if (safeSortField === 'numberOfFoundListings' || safeSortField === 'enabled') {
    jobs.sort((a, b) => dir * (Number(a[safeSortField]) - Number(b[safeSortField])));
  } else if (safeSortField === 'name') {
    jobs.sort((a, b) => dir * String(a.name ?? '').localeCompare(String(b.name ?? '')));
  } else {
    jobs.sort(byNameNullsLast);
  }

  const offset = (safePage - 1) * safePageSize;
  return { totalNumber, page: safePage, result: jobs.slice(offset, offset + safePageSize) };
};
