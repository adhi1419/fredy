/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MONITORING_GRANULARITY,
  monitoringListingPath,
  monitoringListingTitle,
  monitoringRunHasFailures,
  monitoringRunOutcome,
  toggleMonitoringGranularity,
  type MonitoringListing,
  type MonitoringRun,
} from '../../ui/src/services/state/adminState.js';
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

const run = (overrides: Partial<MonitoringRun> = {}): MonitoringRun => ({
  id: 'run-1',
  executionId: 'execution-1',
  jobId: 'job-1',
  jobName: 'Berlin homes',
  providerId: 'provider-1',
  providerName: 'Provider',
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1000,
  outcome: 'completed',
  errorType: null,
  counters: counters(1),
  ...overrides,
});

const listing = (overrides: Partial<MonitoringListing> = {}): MonitoringListing => ({
  listingId: 'listing/1',
  happenedAt: 1,
  jobId: 'job-1',
  jobName: 'Berlin homes',
  providerId: 'provider-1',
  providerName: 'Provider',
  stored: false,
  outcome: 'unknown',
  reason: null,
  title: 'A bright flat',
  providerUrl: null,
  ...overrides,
});

describe('Monitoring ledger behavior', () => {
  it('defaults to Provider and toggles between provider and listing views', () => {
    expect(DEFAULT_MONITORING_GRANULARITY).toBe('provider');
    expect(toggleMonitoringGranularity(DEFAULT_MONITORING_GRANULARITY)).toBe('listing');
    expect(toggleMonitoringGranularity('listing')).toBe('provider');
  });

  it('builds an encoded internal listing link for a titled listing', () => {
    expect(monitoringListingPath(listing().listingId)).toBe('/listings/listing/listing%2F1');
    expect(monitoringListingTitle(listing(), 'Listing unavailable')).toBe('A bright flat');
  });

  it('keeps failed counters visible instead of presenting a plain Completed outcome', () => {
    const failedRun = run({
      counters: { ...counters(1), retryableFailures: 2, terminalFailures: 1, unknownFailures: 1 },
    });
    expect(monitoringRunHasFailures(failedRun)).toBe(true);
    expect(monitoringRunOutcome(failedRun)).toBe('completed-with-issues');
    expect(monitoringRunOutcome(run())).toBe('completed');
  });

  it('uses unavailable text instead of linking a deleted listing', () => {
    const deletedListing = listing({ listingId: 'deleted', title: null });
    expect(monitoringListingTitle(deletedListing, 'Listing unavailable')).toBe('Listing unavailable');
  });
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
