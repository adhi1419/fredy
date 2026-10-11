/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initBackend, loadStorageModule, resetBackend, teardownBackend } from './harness.js';
import { emptyMonitoringCounters } from '../../lib/services/monitoring/monitoringCounters.js';

let monitoring;
let listings;
let jobs;
const now = Date.parse('2026-10-11T10:34:00Z');

beforeAll(async () => {
  await initBackend();
  monitoring = await loadStorageModule('monitoringStorage');
  listings = await loadStorageModule('listingsStorage');
  jobs = await loadStorageModule('jobStorage');
});

beforeEach(async () => {
  await resetBackend();
  await jobs.upsertJob({
    jobId: 'job-1',
    name: 'Berlin rentals',
    userId: 'user-1',
    provider: JSON.stringify([{ id: 'immoscout', enabled: true }]),
    notificationAdapter: '[]',
  });
});

afterAll(async () => {
  await teardownBackend();
});

async function seedListing(id) {
  const listing = {
    id,
    title: id,
    address: 'Street 1, Berlin',
    price: '1000',
    size: '70',
    rooms: '2',
    link: `https://example.com/${id}`,
  };
  await listings.storeListings('job-1', 'immoscout', [listing]);
  return listing.id;
}

function providerRun(counters) {
  return {
    executionId: 'execution-1',
    jobId: 'job-1',
    jobName: 'Berlin rentals',
    providerId: 'immoscout',
    providerName: 'ImmoScout24',
    startedAt: now - 1000,
    finishedAt: now,
    durationMs: 1000,
    outcome: 'completed',
    errorType: null,
    counters,
  };
}

describe('Monitoring Firestore contract', () => {
  it('persists hourly counters, one provider run, and a non-archived active snapshot', async () => {
    await seedListing('active');
    const archived = await seedListing('archived');
    await listings.setListingStatus(archived, 'archived', 'user-1');
    await monitoring.recordProviderRun(providerRun({ ...emptyMonitoringCounters(), newListings: 2 }));

    const rollups = await monitoring.listHourlyRollups(now - 3600000, now + 3600000);
    const runs = await monitoring.listProviderRuns(now - 3600000, now + 3600000);
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ activeListings: 1, counters: { newListings: 2 } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ providerId: 'immoscout', durationMs: 1000 });
  });

  it('adds a manual application once without inventing a provider run', async () => {
    await seedListing('active');
    await monitoring.recordManualApplication({ jobId: 'job-1', providerId: 'immoscout', happenedAt: now });
    const rollups = await monitoring.listHourlyRollups(now - 3600000, now + 3600000);
    expect(rollups[0].counters.manualApplied).toBe(1);
    expect(await monitoring.listProviderRuns(now - 3600000, now + 3600000)).toEqual([]);
  });
});
