/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: watchListStorage
 *
 * Backend-agnostic behavioral contract for the watch list module. Seeds and
 * asserts ONLY through the public storage API. Must pass unchanged against
 * every storage backend (sqlite today, firestore in Phase 2).
 *
 * watch_list has FK to listings(id), which has FK to jobs(id) ON DELETE CASCADE,
 * and jobs has FK to users(id). So we must seed: user -> job -> listing -> watch.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let watchListStorage;
let userStorage;
let jobStorage;
let listingsStorage;

const TEST_USER_ID = 'contract-user-1';
const TEST_JOB_ID = 'contract-job-1';

/** Seed a user, job, and a set of listings so FKs are satisfied. Returns listing ids. */
async function seedListings(listingHashes = ['hash-1', 'hash-2', 'hash-3']) {
  // Seed user
  await userStorage.upsertUser({
    username: 'contractuser',
    password: 'test1234',
    userId: TEST_USER_ID,
    isAdmin: false,
  });

  // Seed job
  jobStorage.upsertJob({
    jobId: TEST_JOB_ID,
    name: 'Contract Test Job',
    provider: [],
    notificationAdapter: [],
    userId: TEST_USER_ID,
  });

  // Seed listings
  const listings = listingHashes.map((hash) => ({
    id: hash,
    hash,
    title: `Listing ${hash}`,
    price: '1000',
    size: '50',
    address: 'Test Street 1',
    link: `https://example.com/${hash}`,
  }));
  listingsStorage.storeListings(TEST_JOB_ID, 'testprovider', listings);

  // storeListings mutates each item's id to the DB primary key; return them.
  return listings.map((l) => l.id);
}

beforeAll(async () => {
  await initBackend();
  watchListStorage = await import('../../lib/services/storage/watchListStorage.js');
  userStorage = await import('../../lib/services/storage/userStorage.js');
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
  listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

describe('watchListStorage contract', () => {
  describe('createWatch', () => {
    it('creates a watch entry and reports created:true', async () => {
      const [listingId] = await seedListings(['hash-1']);
      const result = watchListStorage.createWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ created: true });
    });

    it('is idempotent: double-create returns created:true without error', async () => {
      const [listingId] = await seedListings(['hash-1']);
      watchListStorage.createWatch(listingId, TEST_USER_ID);
      const result = watchListStorage.createWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ created: true });
    });

    it('returns created:false for empty listingId', () => {
      const result = watchListStorage.createWatch('', TEST_USER_ID);
      expect(result).toEqual({ created: false });
    });

    it('returns created:false for empty userId', async () => {
      const [listingId] = await seedListings(['hash-1']);
      const result = watchListStorage.createWatch(listingId, '');
      expect(result).toEqual({ created: false });
    });

    it('isolates watches between users', async () => {
      // Seed a second user
      await userStorage.upsertUser({
        username: 'contractuser2',
        password: 'test1234',
        userId: 'contract-user-2',
        isAdmin: false,
      });

      const [listingId] = await seedListings(['hash-1']);
      watchListStorage.createWatch(listingId, TEST_USER_ID);

      // User 2 has not watched it yet — toggle should create, not delete.
      const toggleResult = watchListStorage.toggleWatch(listingId, 'contract-user-2');
      expect(toggleResult).toEqual({ watched: true });
    });
  });

  describe('deleteWatch', () => {
    it('deletes an existing watch entry', async () => {
      const [listingId] = await seedListings(['hash-1']);
      watchListStorage.createWatch(listingId, TEST_USER_ID);
      const result = watchListStorage.deleteWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ deleted: true });
    });

    it('returns deleted:false when entry does not exist', async () => {
      const [listingId] = await seedListings(['hash-1']);
      const result = watchListStorage.deleteWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ deleted: false });
    });

    it('returns deleted:false for empty params', () => {
      expect(watchListStorage.deleteWatch('', TEST_USER_ID)).toEqual({ deleted: false });
      expect(watchListStorage.deleteWatch('some-id', '')).toEqual({ deleted: false });
    });
  });

  describe('ensureWatch', () => {
    it('creates a watch if none exists and reports watched:true', async () => {
      const [listingId] = await seedListings(['hash-1']);
      const result = watchListStorage.ensureWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ watched: true });
    });

    it('is safe to call when already watched — still reports watched:true', async () => {
      const [listingId] = await seedListings(['hash-1']);
      watchListStorage.createWatch(listingId, TEST_USER_ID);
      const result = watchListStorage.ensureWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ watched: true });
    });

    it('returns watched:false for empty params', () => {
      expect(watchListStorage.ensureWatch('', TEST_USER_ID)).toEqual({ watched: false });
      expect(watchListStorage.ensureWatch('some-id', '')).toEqual({ watched: false });
    });
  });

  describe('toggleWatch', () => {
    it('creates a watch when none exists (toggle ON)', async () => {
      const [listingId] = await seedListings(['hash-1']);
      const result = watchListStorage.toggleWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ watched: true });
    });

    it('removes a watch when one exists (toggle OFF)', async () => {
      const [listingId] = await seedListings(['hash-1']);
      watchListStorage.createWatch(listingId, TEST_USER_ID);
      const result = watchListStorage.toggleWatch(listingId, TEST_USER_ID);
      expect(result).toEqual({ watched: false });
    });

    it('toggle ON then OFF then ON again (full cycle)', async () => {
      const [listingId] = await seedListings(['hash-1']);
      expect(watchListStorage.toggleWatch(listingId, TEST_USER_ID)).toEqual({ watched: true });
      expect(watchListStorage.toggleWatch(listingId, TEST_USER_ID)).toEqual({ watched: false });
      expect(watchListStorage.toggleWatch(listingId, TEST_USER_ID)).toEqual({ watched: true });
    });

    it('returns watched:false for empty params', () => {
      expect(watchListStorage.toggleWatch('', TEST_USER_ID)).toEqual({ watched: false });
      expect(watchListStorage.toggleWatch('some-id', '')).toEqual({ watched: false });
    });
  });

  describe('cross-listing independence', () => {
    it('watching one listing does not affect another', async () => {
      const [listingA, listingB] = await seedListings(['hash-a', 'hash-b']);
      watchListStorage.createWatch(listingA, TEST_USER_ID);

      // Toggle B should create (ON), not interact with A.
      expect(watchListStorage.toggleWatch(listingB, TEST_USER_ID)).toEqual({ watched: true });
      // A should still be watched.
      expect(watchListStorage.toggleWatch(listingA, TEST_USER_ID)).toEqual({ watched: false }); // was on, now off
    });
  });
});
