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

import { getGoogleAccessToken } from '../lib/services/firebaseAdmin.js';
import { mergeHistoricalHour } from '../lib/services/storage/firestore/monitoringStorage.js';
import { emptyMonitoringCounters, recordListingDecisionMetric } from '../lib/services/monitoring/monitoringCounters.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID;
if (!project) throw new Error('Set GOOGLE_CLOUD_PROJECT or FIRESTORE_PROJECT_ID');
const days = Math.min(31, Math.max(1, Number(process.argv[2]) || 30));
const start = Date.now() - days * DAY_MS;
const backfillId = 'cloud-logging-listing-decisions-v1';

function lineFrom(entry) {
  return entry.textPayload ?? entry.jsonPayload?.message ?? entry.jsonPayload?.msg ?? '';
}

function hourStart(timestamp) {
  const date = new Date(timestamp);
  date.setUTCMinutes(0, 0, 0);
  return date.getTime();
}

const token = await getGoogleAccessToken();

async function loggingRequest(payload) {
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

let pageToken = null;
const hours = new Map();
let entriesRead = 0;
do {
  const body = await loggingRequest({
    resourceNames: [`projects/${project}`],
    filter: `timestamp >= "${new Date(start).toISOString()}" AND (textPayload:"LISTING_DECISION " OR jsonPayload.message:"LISTING_DECISION ")`,
    orderBy: 'timestamp asc',
    pageSize: 1000,
    ...(pageToken ? { pageToken } : {}),
  });
  for (const entry of body.entries ?? []) {
    const line = lineFrom(entry);
    const marker = line.indexOf('LISTING_DECISION ');
    if (marker < 0) continue;
    let event;
    try {
      event = JSON.parse(line.slice(marker + 'LISTING_DECISION '.length));
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
      dimensions.set(key, { jobId: event.jobId, providerId: event.providerId, counters: emptyMonitoringCounters() });
    }
    recordListingDecisionMetric(dimensions.get(key).counters, event);
    entriesRead += 1;
  }
  pageToken = body.nextPageToken ?? null;
} while (pageToken);

for (const [bucketStart, dimensions] of [...hours].sort(([a], [b]) => a - b)) {
  await mergeHistoricalHour({ bucketStart, counterDimensions: [...dimensions.values()], backfillId });
}

process.stdout.write(
  `Backfilled ${entriesRead} privacy-safe listing decisions into ${hours.size} hourly rollups (${backfillId}).\n`,
);
process.stdout.write(
  'Active-listing history was not backfilled; its first trustworthy snapshot starts after deployment.\n',
);
