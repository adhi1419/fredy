/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';
import { filterMask, packMobile } from '../../../lib/services/connectivity/mobileBits.js';

const firestore = createFirestoreMemory();

vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));
vi.mock('../../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;

const addListing = (id, overrides = {}) =>
  firestore.seed('listings', id, {
    jobId: 'job-1',
    provider: 'immoscout',
    latitude: 52.52,
    longitude: 13.405,
    isActive: true,
    manuallyDeleted: false,
    createdAt: 1000,
    connectivity: null,
    connectivityMaxDown: null,
    connectivityFiber: null,
    connectivityMobileBits: null,
    connectivityCheckedAt: null,
    ...overrides,
  });

const rowOf = (id) => firestore.read('listings', id);

describe('listingsStorage connectivity', () => {
  let storage;

  beforeEach(async () => {
    firestore.clear();
    firestore.seed('jobs', 'job-1', { userId: 'user-1', sharedWithUser: [] });
    storage = await import('../../../lib/services/storage/listingsStorage.js');
  });

  describe('the work list', () => {
    it('picks up a listing nobody has asked about yet', async () => {
      addListing('never-asked');

      const due = await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 180, now: 10 * DAY });

      expect(due.map((row) => row.id)).toEqual(['never-asked']);
    });

    it('leaves a fresh answer alone and picks up a stale one', async () => {
      addListing('fresh', { connectivityCheckedAt: 100 * DAY });
      addListing('stale', { connectivityCheckedAt: 1 * DAY });

      const due = await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 30, now: 120 * DAY });

      expect(due.map((row) => row.id)).toEqual(['stale']);
    });

    it('skips a listing with no coordinates to look up', async () => {
      addListing('nowhere', { latitude: null, longitude: null });
      addListing('not-found', { latitude: -1, longitude: -1 });
      addListing('located');

      const due = await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 180, now: 10 * DAY });

      expect(due.map((row) => row.id)).toEqual(['located']);
    });

    it('skips inactive and hidden listings', async () => {
      addListing('inactive', { isActive: false });
      addListing('hidden', { manuallyDeleted: true });
      addListing('live');

      const due = await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 180, now: 10 * DAY });

      expect(due.map((row) => row.id)).toEqual(['live']);
    });

    it('honours the batch size', async () => {
      for (let index = 0; index < 5; index += 1) addListing(`l${index}`);

      expect(await storage.getListingsToEnrichConnectivity({ limit: 2, maxAgeDays: 180, now: 10 * DAY })).toHaveLength(
        2,
      );
    });

    it('takes never-asked listings before ones merely due again', async () => {
      addListing('asked-long-ago', { connectivityCheckedAt: 1 * DAY });
      addListing('never-asked');

      const due = await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 30, now: 120 * DAY });

      expect(due.map((row) => row.id)).toEqual(['never-asked', 'asked-long-ago']);
    });
  });

  describe('storing an answer', () => {
    it('writes the payload and filter columns', async () => {
      addListing('l1');
      const connectivity = { maxDownMbit: 1000, fiber: true, source: 'de-bba' };

      await storage.updateListingConnectivity('l1', connectivity, { maxDown: 1000, fiber: 1, mobile: 6 }, 5000);

      expect(rowOf('l1')).toMatchObject({
        connectivity: JSON.stringify(connectivity),
        connectivityMaxDown: 1000,
        connectivityFiber: 1,
        connectivityMobileBits: 6,
        connectivityCheckedAt: 5000,
      });
    });

    it('stamps a lookup that found nothing', async () => {
      addListing('l1');

      await storage.updateListingConnectivity('l1', null, { maxDown: null, fiber: null, mobile: null }, 5000);

      expect(rowOf('l1')).toMatchObject({ connectivity: null, connectivityCheckedAt: 5000 });
      expect(
        (await storage.getListingsToEnrichConnectivity({ limit: 10, maxAgeDays: 180, now: 5000 })).map((r) => r.id),
      ).toEqual([]);
    });
  });

  describe('filtering the overview', () => {
    const idsFor = async (filters) =>
      (await storage.queryListings({ userId: 'user-1', ...filters })).result.map((row) => row.id).sort();

    beforeEach(() => {
      addListing('gigabit-fibre', {
        connectivityMaxDown: 1000,
        connectivityFiber: 1,
        connectivityMobileBits: packMobile({ operators: { dt: { '5g': true } } }),
        connectivityCheckedAt: 1,
      });
      addListing('gigabit-cable', {
        connectivityMaxDown: 1000,
        connectivityFiber: 0,
        connectivityMobileBits: packMobile({ operators: { vf: { '4g': true } } }),
        connectivityCheckedAt: 1,
      });
      addListing('slow', {
        connectivityMaxDown: 50,
        connectivityFiber: 0,
        connectivityMobileBits: packMobile({ neutral: { '4g': true } }),
        connectivityCheckedAt: 1,
      });
      addListing('never-enriched');
    });

    it('returns everything when no connectivity filter is set', async () => {
      expect(await idsFor({})).toEqual(['gigabit-cable', 'gigabit-fibre', 'never-enriched', 'slow']);
    });

    it('keeps only addresses that reach the speed floor', async () => {
      expect(await idsFor({ connectivityMinDown: 100 })).toEqual(['gigabit-cable', 'gigabit-fibre']);
      expect(await idsFor({ connectivityMinDown: 30 })).toEqual(['gigabit-cable', 'gigabit-fibre', 'slow']);
    });

    it('drops a listing nobody has looked up yet', async () => {
      expect(await idsFor({ connectivityMinDown: 30 })).not.toContain('never-enriched');
      expect(await idsFor({ connectivityFiberOnly: true })).not.toContain('never-enriched');
    });

    it('tells fibre apart from a cable line that happens to be just as fast', async () => {
      expect(await idsFor({ connectivityFiberOnly: true })).toEqual(['gigabit-fibre']);
    });

    it('finds a technology whoever provides it', async () => {
      expect(await idsFor({ connectivityMobileMask: filterMask('4g') })).toEqual(['gigabit-cable', 'slow']);
    });

    it('does not answer for the wrong operator', async () => {
      expect(await idsFor({ connectivityMobileMask: filterMask('5g', 'dt') })).toEqual(['gigabit-fibre']);
      expect(await idsFor({ connectivityMobileMask: filterMask('5g', 'vf') })).toEqual([]);
    });

    it('combines with the other filters rather than replacing them', async () => {
      expect(await idsFor({ connectivityMinDown: 100, connectivityFiberOnly: true })).toEqual(['gigabit-fibre']);
    });
  });
});
