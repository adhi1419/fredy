/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const addListing = (
  id,
  { isActive = true, lastCheckedAt = null, deleted = false, failures = 0, manual = false } = {},
) =>
  firestore.seed('listings', id, {
    link: `https://example.com/${id}`,
    provider: 'immowelt',
    jobId: 'job-1',
    isActive,
    manuallyDeleted: deleted,
    lastCheckedAt,
    inactiveSince: null,
    activeCheckFailures: failures,
    activityIsManual: manual,
  });

const rowOf = (id) => firestore.read('listings', id);
const dueIds = async (storage, opts = {}) =>
  (await storage.getListingsDueForActiveCheck({ now: NOW, ...opts })).map((row) => row.id);

describe('alive checker throttling', () => {
  let listingsStorage;

  beforeEach(async () => {
    firestore.clear();
    listingsStorage = await import('../../../lib/services/storage/listingsStorage.js');
  });

  it('includes listings that were never checked', async () => {
    addListing('never-checked');
    expect(await dueIds(listingsStorage)).toEqual(['never-checked']);
  });

  it('excludes a listing checked inside the staleness window', async () => {
    addListing('fresh', { lastCheckedAt: NOW - DAY });
    expect(await dueIds(listingsStorage)).toEqual([]);
  });

  it('includes a listing checked longer ago than the window', async () => {
    addListing('stale', { lastCheckedAt: NOW - 8 * DAY });
    expect(await dueIds(listingsStorage)).toEqual(['stale']);
  });

  it('honours a custom staleness window', async () => {
    addListing('two-days-old', { lastCheckedAt: NOW - 2 * DAY });
    expect(await dueIds(listingsStorage, { staleAfterMs: 7 * DAY })).toEqual([]);
    expect(await dueIds(listingsStorage, { staleAfterMs: DAY })).toEqual(['two-days-old']);
  });

  it('caps how many listings one run takes', async () => {
    for (let i = 0; i < 50; i++) addListing(`id-${i}`);
    expect(await dueIds(listingsStorage, { limit: 10 })).toHaveLength(10);
  });

  it('serves never-checked listings before the least recently checked ones', async () => {
    addListing('checked-long-ago', { lastCheckedAt: NOW - 30 * DAY });
    addListing('never');
    addListing('checked-a-while-ago', { lastCheckedAt: NOW - 10 * DAY });
    expect(await dueIds(listingsStorage)).toEqual(['never', 'checked-long-ago', 'checked-a-while-ago']);
  });

  it('ignores inactive and hidden listings', async () => {
    addListing('gone', { isActive: false });
    addListing('hidden', { deleted: true });
    addListing('unknown', { isActive: null });
    expect(await dueIds(listingsStorage)).toEqual(['unknown']);
  });

  it('never hands over a listing a human marked as available', async () => {
    addListing('normal');
    addListing('corrected', { manual: true });
    expect(await dueIds(listingsStorage)).toEqual(['normal']);
  });

  describe('failure streaks', () => {
    it('re-probes a listing with a failure streak after a day instead of a week', async () => {
      addListing('flaky', { lastCheckedAt: NOW - 2 * DAY, failures: 3 });
      addListing('healthy', { lastCheckedAt: NOW - 2 * DAY });
      expect(await dueIds(listingsStorage)).toEqual(['flaky']);
    });

    it('stops probing a listing that already reached the failure limit', async () => {
      addListing('exhausted', { lastCheckedAt: NOW - 30 * DAY, failures: 10 });
      expect(await dueIds(listingsStorage)).toEqual([]);
    });
  });

  describe('recordActiveCheckFailures', () => {
    it('counts one more failure and stops the listing from being due again today', async () => {
      addListing('flaky');
      expect(await listingsStorage.recordActiveCheckFailures(['flaky'], { checkedAt: NOW })).toEqual([]);
      expect(rowOf('flaky').activeCheckFailures).toBe(1);
      expect(await dueIds(listingsStorage)).toEqual([]);
    });

    it('reports a listing whose streak reached the limit', async () => {
      addListing('done-for', { failures: 9 });
      expect(await listingsStorage.recordActiveCheckFailures(['done-for'], { checkedAt: NOW })).toEqual(['done-for']);
    });

    it('handles a batch beyond the Firestore batch limit', async () => {
      const ids = [];
      for (let i = 0; i < 1500; i++) {
        const id = `bulk-${i}`;
        addListing(id, { failures: 9 });
        ids.push(id);
      }
      expect(await listingsStorage.recordActiveCheckFailures(ids, { checkedAt: NOW })).toHaveLength(1500);
    });

    it('is a no-op for an empty list', async () => {
      expect(await listingsStorage.recordActiveCheckFailures([])).toEqual([]);
    });
  });

  describe('deactivateListings', () => {
    it('stamps when the listing went offline, which starts the retention period', async () => {
      addListing('gone');
      await listingsStorage.deactivateListings(['gone'], NOW);
      expect(rowOf('gone')).toMatchObject({ isActive: false, inactiveSince: NOW, activeCheckFailures: 0 });
    });

    it('keeps the original timestamp when a listing is deactivated again', async () => {
      addListing('gone');
      await listingsStorage.deactivateListings(['gone'], NOW - 10 * DAY);
      await listingsStorage.deactivateListings(['gone'], NOW);
      expect(rowOf('gone').inactiveSince).toBe(NOW - 10 * DAY);
    });
  });

  describe('markListingsChecked', () => {
    it('stops a listing from coming back as due', async () => {
      addListing('probed');
      await listingsStorage.markListingsChecked(['probed'], NOW);
      expect(await dueIds(listingsStorage)).toEqual([]);
    });

    it('clears the failure streak because the probe answered this time', async () => {
      addListing('recovered', { failures: 4 });
      await listingsStorage.markListingsChecked(['recovered'], NOW);
      expect(rowOf('recovered').activeCheckFailures).toBe(0);
    });

    it('handles a batch beyond the Firestore batch limit', async () => {
      const ids = [];
      for (let i = 0; i < 1500; i++) {
        const id = `bulk-${i}`;
        addListing(id);
        ids.push(id);
      }
      await listingsStorage.markListingsChecked(ids, NOW);
      expect(await dueIds(listingsStorage, { limit: 5000 })).toEqual([]);
    });

    it('is a no-op for an empty list', async () => {
      expect(await listingsStorage.markListingsChecked([])).toBeUndefined();
    });
  });
});
