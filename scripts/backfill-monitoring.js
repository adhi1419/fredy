#!/usr/bin/env node
/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */
/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */
/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { pathToFileURL } from 'node:url';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_BACKFILL_DAYS = 30;
export const MAX_LOGGING_PAGES = 100;
export const BACKFILL_ID = 'cloud-logging-listing-decisions-v1';
const LISTING_DECISION_MARKER = 'LISTING_DECISION ';

/**
 * Return the machine-readable payload from a Cloud Logging entry without exposing the entry.
 * @param {Object} entry
 * @returns {string}
 */
export function lineFrom(entry) {
  return entry.textPayload ?? entry.jsonPayload?.message ?? entry.jsonPayload?.msg ?? '';
}

/**
 * Round a timestamp down to its UTC hour.
 * @param {number|string|Date} timestamp
 * @returns {number}
 */
export function hourStart(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.getTime();
}

/**
 * Parse retained listing-decision entries into hour/job/provider accumulators.
 *
 * @param {Object[]} entries Cloud Logging entries from one page.
 * @param {{createMonitoringAccumulator: Function, recordListingDecisionMetric: Function}} monitoring
 * @param {{hours?: Map, entriesRead?: number}} [state]
 * @returns {{hours: Map, entriesRead: number}}
 */
export function collectListingDecisionEvents(entries, monitoring, state = {}) {
  const hours = state.hours ?? new Map();
  let entriesRead = state.entriesRead ?? 0;
  for (const entry of entries ?? []) {
    const line = lineFrom(entry);
    const marker = line.indexOf(LISTING_DECISION_MARKER);
    if (marker < 0) continue;
    let event;
    try {
      event = JSON.parse(line.slice(marker + LISTING_DECISION_MARKER.length));
    } catch {
      continue;
    }
    if (!event.jobId || !event.providerId) continue;
    const bucketStart = hourStart(Date.parse(entry.timestamp));
    if (!Number.isFinite(bucketStart)) continue;
    const key = `${event.jobId}\0${event.providerId}`;
    if (!hours.has(bucketStart)) hours.set(bucketStart, new Map());
    const dimensions = hours.get(bucketStart);
    if (!dimensions.has(key)) {
      dimensions.set(key, {
        jobId: event.jobId,
        providerId: event.providerId,
        accumulator: monitoring.createMonitoringAccumulator(),
      });
    }
    monitoring.recordListingDecisionMetric(dimensions.get(key).accumulator, event, Date.parse(entry.timestamp));
    entriesRead += 1;
  }
  return { hours, entriesRead };
}

/**
 * Finalize rollup dimensions and group compact listing outcomes into one document per UTC hour.
 * @param {Map<number, Map<string, {jobId:string, providerId:string, accumulator:Object}>>} hours
 * @param {{finalizeMonitoringListingOutcomes: Function}} monitoring
 * @returns {{counterDimensions: Map<number, Object[]>, listingHistory: Map<number, Object[]>, uniqueListingOutcomeCount: number}}
 */
export function finalizeBackfill(hours, monitoring) {
  const counterDimensions = new Map();
  const listingHistory = new Map();
  let uniqueListingOutcomeCount = 0;
  for (const [bucketStart, dimensions] of hours) {
    const rollups = [];
    for (const { jobId, providerId, accumulator } of dimensions.values()) {
      rollups.push({ jobId, providerId, counters: accumulator.counters });
      const outcomes = monitoring.finalizeMonitoringListingOutcomes(accumulator);
      uniqueListingOutcomeCount += outcomes.length;
      if (outcomes.length > 0) {
        if (!listingHistory.has(bucketStart)) listingHistory.set(bucketStart, []);
        for (const outcome of outcomes) listingHistory.get(bucketStart).push({ ...outcome, jobId, providerId });
      }
    }
    counterDimensions.set(bucketStart, rollups);
  }
  return { counterDimensions, listingHistory, uniqueListingOutcomeCount };
}

/**
 * Parse the bounded command-line options.
 * @param {string[]} args
 * @returns {{days: number, dryRun: boolean}}
 */
export function parseArguments(args) {
  const daysArgument = args.find((argument) => !argument.startsWith('--'));
  const requestedDays = Number(daysArgument);
  return {
    days: Math.min(MAX_BACKFILL_DAYS, Math.max(1, requestedDays || MAX_BACKFILL_DAYS)),
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * Format a privacy-safe summary for both apply and dry-run modes.
 * @param {{dryRun:boolean, entriesRead:number, rollupHourCount:number, uniqueListingOutcomeCount:number, historyDocumentCount:number, truncatedHistoryDocumentCount?:number}} summary
 * @returns {string}
 */
export function formatSummary(summary) {
  const truncation =
    Number(summary.truncatedHistoryDocumentCount) > 0
      ? `; ${summary.truncatedHistoryDocumentCount} history documents exceed the listing-outcome cap`
      : '';
  return `${summary.dryRun ? 'Dry-run' : 'Backfilled'} ${summary.entriesRead} events into ${summary.rollupHourCount} rollup hours; ${summary.uniqueListingOutcomeCount} unique listing outcomes; ${summary.historyDocumentCount} history documents${truncation} (${BACKFILL_ID}).\n`;
}

async function loggingRequest(token, project, payload) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-goog-user-project': project,
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return response.json();
    const body = await response.text();
    if (response.status !== 429 || attempt === 5) {
      throw new Error(`Cloud Logging ${response.status}: ${body.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error('Cloud Logging retry budget exhausted');
}

async function main() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID;
  if (!project) throw new Error('Set GOOGLE_CLOUD_PROJECT or FIRESTORE_PROJECT_ID');
  const { days, dryRun } = parseArguments(process.argv.slice(2));
  const start = Date.now() - days * DAY_MS;
  const [{ getGoogleAccessToken }, monitoringCounters, monitoringStorage, firestoreModule] = await Promise.all([
    import('../lib/services/firebaseAdmin.js'),
    import('../lib/services/monitoring/monitoringCounters.js'),
    import('../lib/services/storage/firestore/monitoringStorage.js'),
    import('../lib/services/storage/firestore/FirestoreConnection.js'),
  ]);
  const token = await getGoogleAccessToken();
  let pageToken = null;
  let pageCount = 0;
  let state = { hours: new Map(), entriesRead: 0 };
  do {
    if (pageCount >= MAX_LOGGING_PAGES) throw new Error(`Cloud Logging pagination exceeded ${MAX_LOGGING_PAGES} pages`);
    pageCount += 1;
    const body = await loggingRequest(token, project, {
      resourceNames: [`projects/${project}`],
      filter: `timestamp >= "${new Date(start).toISOString()}" AND (textPayload:"${LISTING_DECISION_MARKER}" OR jsonPayload.message:"${LISTING_DECISION_MARKER}")`,
      orderBy: 'timestamp asc',
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    state = collectListingDecisionEvents(body.entries, monitoringCounters, state);
    pageToken = body.nextPageToken ?? null;
  } while (pageToken);

  const finalized = finalizeBackfill(state.hours, monitoringCounters);
  const historyDocumentCount = finalized.listingHistory.size;
  const truncatedHistoryDocumentCount = [...finalized.listingHistory.values()].filter(
    (listingOutcomes) => listingOutcomes.length > monitoringStorage.MAX_LISTING_OUTCOMES,
  ).length;
  if (!dryRun) {
    const { mergeHistoricalHour, mergeHistoricalListingHour } = monitoringStorage;
    const { default: FirestoreConnection } = firestoreModule;
    await FirestoreConnection.init();
    try {
      for (const [bucketStart, dimensions] of [...finalized.counterDimensions].sort(([a], [b]) => a - b)) {
        await mergeHistoricalHour({ bucketStart, counterDimensions: dimensions, backfillId: BACKFILL_ID });
      }
      for (const [bucketStart, listingOutcomes] of [...finalized.listingHistory].sort(([a], [b]) => a - b)) {
        await mergeHistoricalListingHour({ bucketStart, listingOutcomes, backfillId: BACKFILL_ID });
      }
    } finally {
      await FirestoreConnection.close();
    }
  }

  process.stdout.write(
    formatSummary({
      dryRun,
      entriesRead: state.entriesRead,
      rollupHourCount: state.hours.size,
      uniqueListingOutcomeCount: finalized.uniqueListingOutcomeCount,
      historyDocumentCount,
      truncatedHistoryDocumentCount,
    }),
  );
  process.stdout.write(
    'Active-listing history was not backfilled; its first trustworthy snapshot starts after deployment.\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
