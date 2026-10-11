/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMonitoringCounters } from '../../../lib/services/monitoring/monitoringCounters.js';

const mocks = vi.hoisted(() => ({
  getJobs: vi.fn(),
  listProviderRuns: vi.fn(),
  listHistoricalListingOutcomes: vi.fn(),
  getDocsByIds: vi.fn(),
}));

vi.mock('../../../lib/services/storage/jobStorage.js', () => ({ getJobs: mocks.getJobs }));
vi.mock('../../../lib/services/storage/firestore/monitoringStorage.js', () => ({
  latestRollupBefore: vi.fn(),
  listHourlyRollups: vi.fn(),
  listProviderRuns: mocks.listProviderRuns,
  listHistoricalListingOutcomes: mocks.listHistoricalListingOutcomes,
}));
vi.mock('../../../lib/services/storage/firestore/collections.js', () => ({
  COLLECTIONS: { LISTINGS: 'listings' },
  getDocsByIds: mocks.getDocsByIds,
}));

const { fillHourlyBuckets, getMonitoringRuns } = await import('../../../lib/services/monitoring/monitoringService.js');

const hour = 60 * 60 * 1000;
const now = Date.parse('2026-10-11T10:34:00Z');
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

describe('monitoring listing response', () => {
  beforeEach(() => {
    mocks.getJobs.mockReset();
    mocks.listProviderRuns.mockReset();
    mocks.listHistoricalListingOutcomes.mockReset();
    mocks.getDocsByIds.mockReset();
    mocks.getJobs.mockResolvedValue([
      {
        id: 'job-1',
        name: 'Berlin rentals',
        provider: [{ id: 'immoscout', name: 'ImmoScout24' }],
      },
    ]);
    mocks.listProviderRuns.mockResolvedValue([
      {
        id: 'run-1',
        jobId: 'job-1',
        jobName: 'Berlin rentals',
        providerId: 'immoscout',
        providerName: 'ImmoScout24',
        startedAt: now - 1_000,
        finishedAt: now,
        listingOutcomes: [
          {
            listingId: 'listing-1',
            happenedAt: now - 500,
            stored: true,
            outcome: 'terminal',
            reason: 'delivery-error',
          },
          {
            listingId: 'manual-listing',
            happenedAt: now - 250,
            stored: true,
            outcome: 'stored-only',
            reason: 'new-listing',
          },
        ],
      },
    ]);
    mocks.listHistoricalListingOutcomes.mockResolvedValue([
      {
        bucketStart: now - hour,
        listingOutcomes: [
          {
            jobId: 'job-1',
            providerId: 'immoscout',
            listingId: 'manual-listing',
            happenedAt: now - 100,
            stored: true,
            outcome: 'manual-applied',
            reason: null,
          },
          {
            jobId: 'job-1',
            providerId: 'immoscout',
            listingId: 'listing-1',
            happenedAt: now - hour + 123,
            stored: true,
            outcome: 'stored-only',
            reason: 'new-listing',
          },
          {
            jobId: 'job-1',
            providerId: 'immoscout',
            listingId: 'deleted-listing',
            stored: false,
            outcome: 'not-attempted',
            reason: 'missing-applicant-profile',
          },
          {
            jobId: 'job-2',
            providerId: 'other-provider',
            listingId: 'leaked-listing',
            happenedAt: now - hour + 456,
            stored: true,
            outcome: 'stored-only',
            reason: 'new-listing',
          },
        ],
      },
    ]);
    mocks.getDocsByIds.mockResolvedValue([
      {
        id: 'listing-1',
        data: () => ({ title: 'A flat', link: 'https://provider.example/listing-1' }),
      },
      {
        id: 'manual-listing',
        data: () => ({
          title: 'Applied flat',
          link: 'https://provider.example/manual-listing',
          lifecycle: { state: 'applied' },
        }),
      },
    ]);
  });

  it('deduplicates current and historical outcomes and nulls deleted listing metadata', async () => {
    const response = await getMonitoringRuns({
      start: now - 2 * hour,
      end: now + hour,
      jobId: 'job-1',
      providerId: 'immoscout',
    });
    expect(response.runs).toHaveLength(1);
    expect(response.listingsTruncated).toBe(false);
    expect(response.listings).toEqual([
      {
        listingId: 'manual-listing',
        happenedAt: now - 100,
        jobId: 'job-1',
        jobName: 'Berlin rentals',
        providerId: 'immoscout',
        providerName: 'ImmoScout24',
        stored: true,
        outcome: 'manual-applied',
        reason: null,
        title: 'Applied flat',
        providerUrl: 'https://provider.example/manual-listing',
      },
      {
        listingId: 'listing-1',
        happenedAt: now - 500,
        jobId: 'job-1',
        jobName: 'Berlin rentals',
        providerId: 'immoscout',
        providerName: 'ImmoScout24',
        stored: true,
        outcome: 'terminal',
        reason: 'delivery-error',
        title: 'A flat',
        providerUrl: 'https://provider.example/listing-1',
      },
      {
        listingId: 'deleted-listing',
        happenedAt: now - hour,
        jobId: 'job-1',
        jobName: 'Berlin rentals',
        providerId: 'immoscout',
        providerName: 'ImmoScout24',
        stored: false,
        outcome: 'not-attempted',
        reason: 'missing-applicant-profile',
        title: null,
        providerUrl: null,
      },
    ]);
    expect(mocks.getDocsByIds).toHaveBeenCalledWith('listings', ['manual-listing', 'listing-1', 'deleted-listing']);
  });

  it('reports when a source document already omitted older listing outcomes', async () => {
    mocks.listProviderRuns.mockResolvedValue([]);
    mocks.listHistoricalListingOutcomes.mockResolvedValue([
      { bucketStart: now - hour, listingOutcomes: [], listingOutcomesTruncated: 1 },
    ]);
    mocks.getDocsByIds.mockResolvedValue([]);

    const response = await getMonitoringRuns({ start: now - 2 * hour, end: now + hour });

    expect(response.listings).toEqual([]);
    expect(response.listingsTruncated).toBe(true);
  });
});
