/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { monitoringDailyBuckets, monitoringRangeFor } from '../../ui/src/views/admin/pages/monitoringTime.js';
import type { MonitoringBucket } from '../../ui/src/services/state/adminState.js';

const counters = (newListings: number): MonitoringBucket['counters'] => ({
  newListings,
  providerConfirmed: 0,
  manualApplied: 0,
  retryableFailures: 0,
  terminalFailures: 0,
  unknownFailures: 0,
  notAttempted: 0,
});

describe('Monitoring page time model', () => {
  it('offers rolling 24h, 7d, 30d and browser-local MTD ranges', () => {
    const now = new Date(2026, 9, 11, 12).getTime();
    expect(monitoringRangeFor('24h', now).start).toBe(now - 24 * 60 * 60 * 1000);
    expect(monitoringRangeFor('7d', now).start).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(monitoringRangeFor('30d', now).start).toBe(now - 30 * 24 * 60 * 60 * 1000);
    expect(monitoringRangeFor('mtd', now).start).toBe(new Date(2026, 9, 1).getTime());
    expect(monitoringRangeFor('7d', now).monthStart).toBe(new Date(2026, 9, 1).getTime());
  });

  it('sums funnel counters per local day and keeps the final active-listing snapshot', () => {
    const day = new Date(2026, 9, 11).getTime();
    const result = monitoringDailyBuckets([
      { start: day + 10, end: day + 20, activeListings: 10, counters: counters(2), sampled: true },
      { start: day + 30, end: day + 40, activeListings: 12, counters: counters(3), sampled: false },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ end: day + 40, activeListings: 12, sampled: true });
    expect(result[0].counters.newListings).toBe(5);
  });
});
