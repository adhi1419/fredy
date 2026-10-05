/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';
import { MIN_AUTO_ARCHIVE_MS } from '../../../lib/services/listings/staleArchive.js';

const firestore = createFirestoreMemory();

vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seed a listing whose state-entry timestamp sits `ageMs` before NOW. For `applied`/`viewed` the
 * age is stamped on the matching per-state timestamp (appliedAt/viewedAt) and createdAt is pushed
 * far enough back that the row's staleness can only come from the per-state window, never createdAt.
 */
const seedListing = (id, { jobId, ageMs, state = 'new', manuallyDeleted = false } = {}) => {
  const ts = NOW - ageMs;
  const lifecycle = { state, source: null, changedAt: ts, changedBy: null, appliedAt: null, viewedAt: null };
  if (state === 'applied') lifecycle.appliedAt = ts;
  if (state === 'viewed') lifecycle.viewedAt = ts;
  // createdAt leads the state entry (a listing is created before it is applied/viewed). For `new`
  // it IS the reference; otherwise it is old enough to be past the 14-day prefilter so the row
  // reaches the per-state rule.
  const createdAt = state === 'new' ? ts : NOW - 100 * DAY_MS;
  return firestore.seed('listings', id, { jobId, createdAt, manuallyDeleted, lifecycle });
};

const stateOf = (id) => firestore.read('listings', id)?.lifecycle?.state;

describe('archiveStaleListingsForJob', () => {
  let archiveStaleListingsForJob;

  beforeEach(async () => {
    firestore.clear();
    vi.restoreAllMocks();
    ({ archiveStaleListingsForJob } = await import('../../../lib/services/storage/listingsStorage.js'));
  });

  it('applies the per-state window: new 14d, applied 30d (appliedAt), viewed 45d (viewedAt)', async () => {
    // new
    seedListing('new-edge', { jobId: 'job-a', ageMs: 14 * DAY_MS }); // exact: kept
    seedListing('new-stale', { jobId: 'job-a', ageMs: 14 * DAY_MS + 1 }); // +1ms: archived
    // applied — measured from appliedAt
    seedListing('applied-young', { jobId: 'job-a', ageMs: 29 * DAY_MS, state: 'applied' });
    seedListing('applied-stale', { jobId: 'job-a', ageMs: 31 * DAY_MS, state: 'applied' });
    // viewed — measured from viewedAt
    seedListing('viewed-young', { jobId: 'job-a', ageMs: 44 * DAY_MS, state: 'viewed' });
    seedListing('viewed-stale', { jobId: 'job-a', ageMs: 46 * DAY_MS, state: 'viewed' });

    const result = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(result).toEqual({ archived: 3 });
    expect(stateOf('new-stale')).toBe('archived');
    expect(stateOf('applied-stale')).toBe('archived');
    expect(stateOf('viewed-stale')).toBe('archived');
    // Kept — inside their windows.
    expect(stateOf('new-edge')).toBe('new');
    expect(stateOf('applied-young')).toBe('applied');
    expect(stateOf('viewed-young')).toBe('viewed');
  });

  it('an applied listing just over 14 days but under 30 is NOT archived (uses its own window)', async () => {
    seedListing('applied-20d', { jobId: 'job-a', ageMs: 20 * DAY_MS, state: 'applied' });

    const result = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(result).toEqual({ archived: 0 });
    expect(stateOf('applied-20d')).toBe('applied');
  });

  it('never touches archived, manuallyDeleted, or another job, and never crosses jobs', async () => {
    seedListing('already', { jobId: 'job-a', ageMs: 100 * DAY_MS, state: 'archived' });
    seedListing('deleted', { jobId: 'job-a', ageMs: 100 * DAY_MS, manuallyDeleted: true });
    seedListing('other-job', { jobId: 'job-b', ageMs: 100 * DAY_MS });

    const result = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(result).toEqual({ archived: 0 });
    expect(stateOf('already')).toBe('archived');
    expect(stateOf('deleted')).toBe('new');
    expect(stateOf('other-job')).toBe('new');
  });

  it('is a no-op on a second pass and deletes nothing', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: 14 * DAY_MS + 1 });

    const first = await archiveStaleListingsForJob('job-a', { now: NOW });
    const second = await archiveStaleListingsForJob('job-a', { now: NOW });

    expect(first).toEqual({ archived: 1 });
    expect(second).toEqual({ archived: 0 });
    expect(firestore.read('listings', 'stale')).toBeDefined();
    expect(stateOf('stale')).toBe('archived');
  });

  it('stamps the archive transition as an auto-archive at the reference time', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: 14 * DAY_MS + 1 });

    await archiveStaleListingsForJob('job-a', { now: NOW });

    const row = firestore.read('listings', 'stale');
    expect(row.lifecycle).toMatchObject({ state: 'archived', source: 'auto-archive', changedAt: NOW });
    expect(row).not.toHaveProperty('status');
  });

  it('is a no-op without a job id', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: 14 * DAY_MS + 1 });

    const result = await archiveStaleListingsForJob(null, { now: NOW });

    expect(result).toEqual({ archived: 0 });
    expect(stateOf('stale')).toBe('new');
  });

  it('queries with createdAt < the 14-day (MIN) cutoff and adds no extra where clause', async () => {
    seedListing('stale', { jobId: 'job-a', ageMs: 14 * DAY_MS + 1 });

    const whereCalls = [];
    const realCollection = firestore.connection.collection.bind(firestore.connection);
    const spy = vi.spyOn(firestore.connection, 'collection').mockImplementation((name) => {
      const ref = realCollection(name);
      if (name !== 'listings') return ref;
      const wrap = (query) => ({
        ...query,
        where: (field, operator, expected) => {
          whereCalls.push({ field, operator, expected });
          return wrap(query.where(field, operator, expected));
        },
      });
      return { ...ref, where: (f, o, e) => wrap(ref).where(f, o, e), doc: ref.doc };
    });

    await archiveStaleListingsForJob('job-a', { now: NOW });
    spy.mockRestore();

    // Exactly the four original where clauses — no new field was introduced.
    expect(whereCalls).toEqual([
      { field: 'jobId', operator: '==', expected: 'job-a' },
      { field: 'manuallyDeleted', operator: '==', expected: false },
      { field: 'lifecycle.state', operator: 'in', expected: ['new', 'applied', 'viewed'] },
      { field: 'createdAt', operator: '<', expected: NOW - MIN_AUTO_ARCHIVE_MS },
    ]);
    expect(NOW - MIN_AUTO_ARCHIVE_MS).toBe(NOW - 14 * DAY_MS);
  });
});
