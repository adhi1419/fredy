/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();
vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({ default: firestore.connection }));

const storage = await import('../../../lib/services/storage/firestore/monitoringStorage.js');
const { emptyMonitoringCounters } = await import('../../../lib/services/monitoring/monitoringCounters.js');

const finishedAt = Date.parse('2026-10-11T10:34:00Z');
const run = (overrides = {}) => ({
  executionId: 'execution-1',
  jobId: 'job-1',
  jobName: 'Berlin rentals',
  providerId: 'immoscout',
  providerName: 'ImmoScout24',
  startedAt: finishedAt - 10_000,
  finishedAt,
  durationMs: 10_000,
  outcome: 'completed',
  errorType: null,
  counters: { ...emptyMonitoringCounters(), newListings: 2, providerConfirmed: 1 },
  ...overrides,
});

beforeEach(() => {
  firestore.clear();
  firestore.seed('listings', 'listing-1', {
    jobId: 'job-1',
    provider: 'immoscout',
    isActive: true,
    manuallyDeleted: false,
    lifecycle: { state: 'new' },
  });
  firestore.seed('listings', 'archived', {
    jobId: 'job-1',
    provider: 'immoscout',
    isActive: true,
    manuallyDeleted: false,
    lifecycle: { state: 'archived' },
  });
});

describe('monitoring storage', () => {
  it('writes one run and an hourly rollup while excluding archived listings from the active count', async () => {
    await storage.recordProviderRun(run());
    const hourly = firestore.list('monitoring_hourly');
    const runs = firestore.list('monitoring_runs');
    const state = firestore.read('monitoring_state', 'active-listings');
    expect(hourly).toHaveLength(1);
    expect(hourly[0]).toMatchObject({ activeListings: 1, counters: { newListings: 2, providerConfirmed: 1 } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ jobId: 'job-1', providerId: 'immoscout', durationMs: 10_000 });
    expect(state.dimensions).toEqual([{ jobId: 'job-1', providerId: 'immoscout', count: 1 }]);
  });

  it('merges a historical hour only once per backfill id', async () => {
    const input = {
      bucketStart: finishedAt - (finishedAt % 3600000),
      counterDimensions: [
        { jobId: 'job-1', providerId: 'immoscout', counters: { ...emptyMonitoringCounters(), newListings: 4 } },
      ],
      backfillId: 'logging-v1',
    };
    await storage.mergeHistoricalHour(input);
    await storage.mergeHistoricalHour(input);
    expect(firestore.list('monitoring_hourly')[0].counters.newListings).toBe(4);
  });

  it('accumulates counters in the same hour and records manual applications without a synthetic run', async () => {
    await storage.recordProviderRun(run());
    await storage.recordProviderRun(
      run({ executionId: 'execution-2', counters: { ...emptyMonitoringCounters(), newListings: 3 } }),
    );
    await storage.recordManualApplication({ jobId: 'job-1', providerId: 'immoscout', happenedAt: finishedAt });
    const hourly = firestore.list('monitoring_hourly')[0];
    expect(hourly.counters).toMatchObject({ newListings: 5, providerConfirmed: 1, manualApplied: 1 });
    expect(firestore.list('monitoring_runs')).toHaveLength(2);
  });

  it('lists bounded hourly rollups and provider runs', async () => {
    await storage.recordProviderRun(run());
    expect(await storage.listHourlyRollups(finishedAt - 3600000, finishedAt + 3600000)).toHaveLength(1);
    expect(await storage.listProviderRuns(finishedAt - 3600000, finishedAt + 3600000)).toHaveLength(1);
  });
});
