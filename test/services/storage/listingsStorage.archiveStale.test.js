/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';
import { STALE_ARCHIVE_MS } from '../../../lib/services/listings/staleArchive.js';

const firestore = createFirestoreMemory();

vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const NOW = 1_700_000_000_000;

const seedListing = (id, { jobId, ageMs, state = 'new', manuallyDeleted = false } = {}) =>
  firestore.seed('listings', id, {
    jobId,
    createdAt: NOW - ageMs,
    manuallyDeleted,
    lifecycle: { state, source: null, changedAt: NOW - ageMs, changedBy: null, appliedAt: null, viewedAt: null },
  });

const stateOf = (id) => firestore.read('listings', id)?.lifecycle?.state;

describe('archiveStaleListingsForJob', () => {
  let archiveStaleListingsForJob;

  beforeEach(async () => {
    firestore.clear();
    ({ archiveStaleListingsForJob } = await import('../../../lib/services/storage/listingsStorage.js'));
  });

  it("archives only this job's strictly-older-than-a-week, non-archived, non-deleted listings", async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS + 1 });
    seedListing('edge', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS }); // exactly one week: not stale
    seedListing('fresh', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS - 1 });
    seedListing('already', { jobId: 'job-a', ageMs: 30 * STALE_ARCHIVE_MS, state: 'archived' });
    seedListing('deleted', { jobId: 'job-a', ageMs: 30 * STALE_ARCHIVE_MS, manuallyDeleted: true });
    seedListing('other-job', { jobId: 'job-b', ageMs: 30 * STALE_ARCHIVE_MS });

    const result = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(result).toEqual({ archived: 1 });
    expect(stateOf('stale')).toBe('archived');
    // Untouched: edge, fresh, deleted, and the other job's stale listing.
    expect(stateOf('edge')).toBe('new');
    expect(stateOf('fresh')).toBe('new');
    expect(stateOf('deleted')).toBe('new');
    expect(stateOf('other-job')).toBe('new');
  });

  it('preserves per-job isolation and never crosses into another job', async () => {
    seedListing('a-stale', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS + 1 });
    seedListing('b-stale', { jobId: 'job-b', ageMs: STALE_ARCHIVE_MS + 1 });

    await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(stateOf('a-stale')).toBe('archived');
    expect(stateOf('b-stale')).toBe('new');
  });

  it('is a no-op on a second pass and deletes nothing', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS + 1 });

    const first = await archiveStaleListingsForJob('job-a', { now: NOW });
    const second = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(first).toEqual({ archived: 1 });
    expect(second).toEqual({ archived: 0 });
    // The row still exists (archived, not deleted).
    expect(firestore.read('listings', 'stale')).toBeDefined();
    expect(stateOf('stale')).toBe('archived');
  });

  it('stamps the archive transition as an auto-archive at the reference time', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS + 1 });

    await archiveStaleListingsForJob('job-a', { now: NOW });

    const row = firestore.read('listings', 'stale');
    expect(row.lifecycle).toMatchObject({ state: 'archived', source: 'auto-archive', changedAt: NOW });
    // Legacy status projection follows the canonical lifecycle for compatibility-window clients.
    expect(row.status).toBeNull();
  });

  it('is a no-op without a job id', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: STALE_ARCHIVE_MS + 1 });

    const result = await archiveStaleListingsForJob(null, { now: NOW });

    expect(result).toEqual({ archived: 0 });
    expect(stateOf('stale')).toBe('new');
  });
});
