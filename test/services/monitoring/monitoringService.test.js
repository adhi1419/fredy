/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { fillHourlyBuckets } from '../../../lib/services/monitoring/monitoringService.js';
import { emptyMonitoringCounters } from '../../../lib/services/monitoring/monitoringCounters.js';

const hour = 60 * 60 * 1000;
const dimension = (jobId, providerId, count) => ({ jobId, providerId, count });
const counterDimension = (jobId, providerId, newListings) => ({
  jobId,
  providerId,
  counters: { ...emptyMonitoringCounters(), newListings },
});

describe('monitoring hourly buckets', () => {
  it('carries active snapshots through empty hours and filters counters by job/provider', () => {
    const baseline = { activeDimensions: [dimension('j1', 'p1', 5), dimension('j2', 'p2', 7)] };
    const rollups = [
      {
        bucketStart: hour,
        activeDimensions: [dimension('j1', 'p1', 6), dimension('j2', 'p2', 7)],
        counters: { ...emptyMonitoringCounters(), newListings: 5 },
        counterDimensions: [counterDimension('j1', 'p1', 2), counterDimension('j2', 'p2', 3)],
      },
    ];
    const buckets = fillHourlyBuckets({ start: 0, end: 3 * hour, rollups, baseline, jobId: 'j1', providerId: 'p1' });
    expect(buckets.map(({ activeListings }) => activeListings)).toEqual([5, 6, 6]);
    expect(buckets.map(({ counters }) => counters.newListings)).toEqual([0, 2, 0]);
    expect(buckets.map(({ sampled }) => sampled)).toEqual([false, true, false]);
  });
});
