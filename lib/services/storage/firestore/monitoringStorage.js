/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { randomUUID } from 'node:crypto';
import FirestoreConnection from '../firestore/FirestoreConnection.js';
import { COLLECTIONS } from '../firestore/collections.js';
import { listingsCol } from '../firestore/listingsShared.js';
import {
  addMonitoringCounters,
  emptyMonitoringCounters,
  normalizeMonitoringCounters,
} from '../../monitoring/monitoringCounters.js';

const ACTIVE_LIFECYCLE_STATES = ['new', 'applied', 'viewed'];
const RUN_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const ROLLUP_RETENTION_MS = 13 * 31 * 24 * 60 * 60 * 1000;
const ACTIVE_STATE_ID = 'active-listings';

const hourlyCol = () => FirestoreConnection.collection(COLLECTIONS.MONITORING_HOURLY);
const runsCol = () => FirestoreConnection.collection(COLLECTIONS.MONITORING_RUNS);
const stateCol = () => FirestoreConnection.collection(COLLECTIONS.MONITORING_STATE);

function hourStart(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.getTime();
}

function dimensionRows(value, withCounters = false) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row) => typeof row?.jobId === 'string' && typeof row?.providerId === 'string')
    .map((row) => ({
      jobId: row.jobId,
      providerId: row.providerId,
      ...(withCounters ? { counters: normalizeMonitoringCounters(row.counters) } : {}),
      ...(!withCounters ? { count: Math.max(0, Math.floor(Number(row.count) || 0)) } : {}),
    }));
}

function replaceActiveDimension(rows, jobId, providerId, count) {
  const next = rows.filter((row) => row.jobId !== jobId || row.providerId !== providerId);
  next.push({ jobId, providerId, count });
  return next.sort((a, b) => a.jobId.localeCompare(b.jobId) || a.providerId.localeCompare(b.providerId));
}

function addCounterDimension(rows, jobId, providerId, counters) {
  const next = rows.map((row) => ({ ...row, counters: normalizeMonitoringCounters(row.counters) }));
  let row = next.find((entry) => entry.jobId === jobId && entry.providerId === providerId);
  if (row == null) {
    row = { jobId, providerId, counters: emptyMonitoringCounters() };
    next.push(row);
  }
  addMonitoringCounters(row.counters, counters);
  return next.sort((a, b) => a.jobId.localeCompare(b.jobId) || a.providerId.localeCompare(b.providerId));
}

function sumCounters(rows) {
  const total = emptyMonitoringCounters();
  for (const row of rows) addMonitoringCounters(total, row.counters);
  return total;
}

/** One billed aggregation read for up to 1,000 matching listing index entries. */
export async function countActiveListings(jobId, providerId) {
  const aggregate = await listingsCol()
    .where('jobId', '==', jobId)
    .where('provider', '==', providerId)
    .where('isActive', '==', true)
    .where('manuallyDeleted', '==', false)
    .where('lifecycle.state', 'in', ACTIVE_LIFECYCLE_STATES)
    .count()
    .get();
  return Number(aggregate.data().count) || 0;
}

async function writeRollup({ jobId, providerId, counters, activeListings, happenedAt, run = null }) {
  const db = FirestoreConnection.getConnection();
  const bucketStart = hourStart(happenedAt);
  const stateRef = stateCol().doc(ACTIVE_STATE_ID);
  const hourRef = hourlyCol().doc(new Date(bucketStart).toISOString().slice(0, 13));
  const runRef = run == null ? null : runsCol().doc(randomUUID());

  await db.runTransaction(async (transaction) => {
    const [stateSnap, hourSnap] = await Promise.all([transaction.get(stateRef), transaction.get(hourRef)]);
    const previousActive = dimensionRows(stateSnap.exists ? stateSnap.data().dimensions : []);
    const activeDimensions = replaceActiveDimension(previousActive, jobId, providerId, activeListings);
    const activeChanged = JSON.stringify(activeDimensions) !== JSON.stringify(previousActive);
    if (activeChanged || !stateSnap.exists) {
      transaction.set(stateRef, { dimensions: activeDimensions, updatedAt: happenedAt });
    }

    const priorHour = hourSnap.exists ? hourSnap.data() : {};
    const counterDimensions = addCounterDimension(
      dimensionRows(priorHour.counterDimensions, true),
      jobId,
      providerId,
      counters,
    );
    transaction.set(hourRef, {
      bucketStart,
      bucketEnd: bucketStart + 60 * 60 * 1000,
      counters: sumCounters(counterDimensions),
      counterDimensions,
      activeListings: activeDimensions.reduce((sum, row) => sum + row.count, 0),
      activeDimensions,
      updatedAt: happenedAt,
      expiresAt: new Date(bucketStart + ROLLUP_RETENTION_MS),
    });

    if (runRef != null) {
      transaction.set(runRef, { ...run, expiresAt: new Date(happenedAt + RUN_RETENTION_MS) });
    }
  });
}

/** Persist one provider pass: one aggregation read and normally two writes. */
export async function recordProviderRun(run) {
  const activeListings = await countActiveListings(run.jobId, run.providerId);
  await writeRollup({
    jobId: run.jobId,
    providerId: run.providerId,
    counters: run.counters,
    activeListings,
    happenedAt: run.finishedAt,
    run,
  });
}

/** Record a user-declared application and refresh the active snapshot for its dimension. */
export async function recordManualApplication({ jobId, providerId, happenedAt = Date.now() }) {
  const counters = emptyMonitoringCounters();
  counters.manualApplied = 1;
  const activeListings = await countActiveListings(jobId, providerId);
  await writeRollup({ jobId, providerId, counters, activeListings, happenedAt });
}

/** Refresh active-listing history after a lifecycle transition without adding funnel events. */
export async function recordActiveSnapshot({ jobId, providerId, happenedAt = Date.now() }) {
  const activeListings = await countActiveListings(jobId, providerId);
  await writeRollup({
    jobId,
    providerId,
    counters: emptyMonitoringCounters(),
    activeListings,
    happenedAt,
  });
}

export async function listHourlyRollups(start, end) {
  const snapshot = await hourlyCol()
    .where('bucketStart', '>=', start)
    .where('bucketStart', '<', end)
    .orderBy('bucketStart', 'asc')
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function latestRollupBefore(start) {
  const snapshot = await hourlyCol().where('bucketStart', '<', start).orderBy('bucketStart', 'desc').limit(1).get();
  const doc = snapshot.docs[0];
  return doc == null ? null : { id: doc.id, ...doc.data() };
}

export async function listProviderRuns(start, end, limit = 200) {
  const snapshot = await runsCol()
    .where('startedAt', '>=', start)
    .where('startedAt', '<', end)
    .orderBy('startedAt', 'asc')
    .limit(Math.min(500, Math.max(1, limit)))
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Merge one hour of retained Cloud Logging counters exactly once. Historical active-listing values
 * are deliberately left untouched because no trustworthy snapshot exists in the log stream.
 */
export async function mergeHistoricalHour({ bucketStart, counterDimensions, backfillId }) {
  const hourRef = hourlyCol().doc(new Date(bucketStart).toISOString().slice(0, 13));
  await FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snap = await transaction.get(hourRef);
    const previous = snap.exists ? snap.data() : {};
    const backfills = Array.isArray(previous.backfills) ? previous.backfills : [];
    if (backfills.includes(backfillId)) return;
    let dimensions = dimensionRows(previous.counterDimensions, true);
    for (const row of counterDimensions) {
      dimensions = addCounterDimension(dimensions, row.jobId, row.providerId, row.counters);
    }
    transaction.set(hourRef, {
      ...previous,
      bucketStart,
      bucketEnd: bucketStart + 60 * 60 * 1000,
      counters: sumCounters(dimensions),
      counterDimensions: dimensions,
      backfills: [...backfills, backfillId],
      updatedAt: Date.now(),
      expiresAt: new Date(bucketStart + ROLLUP_RETENTION_MS),
    });
  });
}
