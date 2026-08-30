/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: listingsStorage (core behaviors)
 *
 * Backend-agnostic behavioral contract for storage, dedup, query, delete, and
 * access control. Seeds and asserts ONLY through the public storage API.
 * Must pass unchanged against every storage backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let listingsStorage;
let userStorage;
let jobStorage;

beforeAll(async () => {
  await initBackend();
  listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  userStorage = await import('../../lib/services/storage/userStorage.js');
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

// ── helpers ──────────────────────────────────────────────────────────────────

const makeListing = (hash, overrides = {}) => ({
  id: hash,
  price: 1000,
  size: 60,
  rooms: 2,
  title: `Flat ${hash}`,
  image: null,
  description: 'nice place',
  address: 'Hauptstrasse 1',
  link: `https://example.com/${hash}`,
  ...overrides,
});

async function seedUser(id, { isAdmin = false } = {}) {
  await userStorage.upsertUser({ userId: id, username: `user-${id}`, password: 'test123', isAdmin });
}

function seedJob(id, userId, { shareWithUsers = [], name = null, dealType = null } = {}) {
  jobStorage.upsertJob({
    jobId: id,
    name: name ?? `Job ${id}`,
    userId,
    provider: ['immoscout'],
    notificationAdapter: [],
    shareWithUsers,
    dealType,
  });
}

// ── storeListings ───────────────────────────────────────────────────────────

describe('listingsStorage contract', () => {
  describe('storeListings', () => {
    it('persists a listing and returns the DB id on the input object', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('hash-1')];

      listingsStorage.storeListings('j1', 'immoscout', items);

      // The id on the item was mutated to the DB primary key
      expect(typeof items[0].id).toBe('string');
      expect(items[0].id.length).toBeGreaterThan(0);
      // Verify it was actually persisted by fetching it
      const fetched = listingsStorage.getListingById(items[0].id, 'u1');
      expect(fetched).not.toBeNull();
      expect(fetched.title).toBe('Flat hash-1');
    });

    it('propagates the existing row id when hash conflicts within one batch', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('dup-hash'), makeListing('dup-hash')];

      listingsStorage.storeListings('j1', 'immoscout', items);

      // Both items must reference the same actual row
      expect(items[0].id).toBe(items[1].id);
      const fetched = listingsStorage.getListingById(items[0].id, 'u1');
      expect(fetched).not.toBeNull();
    });

    it('propagates the existing row id when hash conflicts across providers of the same job', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');

      const first = [makeListing('shared-hash')];
      listingsStorage.storeListings('j1', 'immoscout', first);
      const storedId = first[0].id;

      const second = [makeListing('shared-hash')];
      listingsStorage.storeListings('j1', 'immowelt', second);

      expect(second[0].id).toBe(storedId);
    });

    it('keeps the same hash separate across different jobs', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      seedJob('j2', 'u1');

      const a = [makeListing('hash-x')];
      const b = [makeListing('hash-x')];
      listingsStorage.storeListings('j1', 'immoscout', a);
      listingsStorage.storeListings('j2', 'immoscout', b);

      expect(a[0].id).not.toBe(b[0].id);
    });

    it('strips parenthesised address suffixes', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('hash-addr', { address: 'Markt 5 (Altstadt)' })];

      listingsStorage.storeListings('j1', 'immoscout', items);

      const fetched = listingsStorage.getListingById(items[0].id, 'u1');
      expect(fetched.address).toBe('Markt 5');
    });

    it('ignores empty and non-array inputs', () => {
      expect(listingsStorage.storeListings('j1', 'immoscout', [])).toBeUndefined();
      expect(listingsStorage.storeListings('j1', 'immoscout', null)).toBeUndefined();
    });
  });

  // ── getKnownListingHashesForJobAndProvider ─────────────────────────────────

  describe('getKnownListingHashesForJobAndProvider', () => {
    it('returns stored hashes scoped to job + provider', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      seedJob('j2', 'u1');

      listingsStorage.storeListings('j1', 'immoscout', [makeListing('h1'), makeListing('h2')]);
      listingsStorage.storeListings('j1', 'immowelt', [makeListing('h3')]);
      listingsStorage.storeListings('j2', 'immoscout', [makeListing('h4')]);

      const hashes = listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout');
      expect(hashes).toEqual(expect.arrayContaining(['h1', 'h2']));
      expect(hashes).not.toContain('h3');
      expect(hashes).not.toContain('h4');
      expect(hashes).toHaveLength(2);
    });

    it('returns an empty array when no listings exist', () => {
      expect(listingsStorage.getKnownListingHashesForJobAndProvider('nope', 'nope')).toEqual([]);
    });

    it('includes hashes of soft-deleted (manually_deleted) listings', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('tombstone-hash')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);

      const hashes = listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout');
      expect(hashes).toContain('tombstone-hash');
    });
  });

  // ── queryListings ──────────────────────────────────────────────────────────

  describe('queryListings', () => {
    it('returns paginated results with totalNumber', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = Array.from({ length: 5 }, (_, i) => makeListing(`page-${i}`));
      listingsStorage.storeListings('j1', 'immoscout', items);

      const result = listingsStorage.queryListings({ pageSize: 2, page: 1, userId: 'u1' });
      expect(result.totalNumber).toBe(5);
      expect(result.result).toHaveLength(2);
      expect(result.page).toBe(1);

      const page2 = listingsStorage.queryListings({ pageSize: 2, page: 2, userId: 'u1' });
      expect(page2.result).toHaveLength(2);
    });

    it('sorts by price ascending and descending', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      listingsStorage.storeListings('j1', 'immoscout', [
        makeListing('cheap', { price: 500 }),
        makeListing('mid', { price: 1000 }),
        makeListing('expensive', { price: 2000 }),
      ]);

      const asc = listingsStorage.queryListings({ sortField: 'price', sortDir: 'asc', userId: 'u1' });
      expect(asc.result.map((r) => r.price)).toEqual([500, 1000, 2000]);

      const desc = listingsStorage.queryListings({ sortField: 'price', sortDir: 'desc', userId: 'u1' });
      expect(desc.result.map((r) => r.price)).toEqual([2000, 1000, 500]);
    });

    describe('user scoping', () => {
      it('owner sees listings from their own job', async () => {
        await seedUser('owner');
        seedJob('j-owner', 'owner');
        listingsStorage.storeListings('j-owner', 'immoscout', [makeListing('owned')]);

        const result = listingsStorage.queryListings({ userId: 'owner' });
        expect(result.totalNumber).toBe(1);
      });

      it('other user cannot see listings from a job they do not own', async () => {
        await seedUser('owner');
        await seedUser('stranger');
        seedJob('j-owner', 'owner');
        listingsStorage.storeListings('j-owner', 'immoscout', [makeListing('private')]);

        const result = listingsStorage.queryListings({ userId: 'stranger' });
        expect(result.totalNumber).toBe(0);
      });

      it('shared_with_user can see listings from a shared job', async () => {
        await seedUser('owner');
        await seedUser('shared');
        seedJob('j-shared', 'owner', { shareWithUsers: ['shared'] });
        listingsStorage.storeListings('j-shared', 'immoscout', [makeListing('shared-listing')]);

        const result = listingsStorage.queryListings({ userId: 'shared' });
        expect(result.totalNumber).toBe(1);
      });

      it('admin sees all listings regardless of ownership', async () => {
        await seedUser('owner');
        await seedUser('admin', { isAdmin: true });
        seedJob('j-other', 'owner');
        listingsStorage.storeListings('j-other', 'immoscout', [makeListing('admin-visible')]);

        const result = listingsStorage.queryListings({ isAdmin: true, userId: 'admin' });
        expect(result.totalNumber).toBe(1);
      });
    });

    it('hiddenOnly returns only soft-deleted listings', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('vis'), makeListing('hid')];
      listingsStorage.storeListings('j1', 'immoscout', items);
      listingsStorage.deleteListingsById([items[1].id]);

      const hidden = listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' });
      expect(hidden.totalNumber).toBe(1);
      expect(hidden.result[0].hash).toBe('hid');

      const visible = listingsStorage.queryListings({ hiddenOnly: false, userId: 'u1' });
      expect(visible.totalNumber).toBe(1);
      expect(visible.result[0].hash).toBe('vis');
    });

    it('freeTextFilter matches on title, address, provider, or link', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      listingsStorage.storeListings('j1', 'immoscout', [
        makeListing('a', { title: 'Sunny Loft Berlin', address: 'Kreuzberg' }),
        makeListing('b', { title: 'Dark Basement', address: 'Hamburg' }),
      ]);

      const result = listingsStorage.queryListings({ freeTextFilter: 'Berlin', userId: 'u1' });
      expect(result.totalNumber).toBe(1);
      expect(result.result[0].title).toBe('Sunny Loft Berlin');
    });
  });

  // ── getListingById ─────────────────────────────────────────────────────────

  describe('getListingById', () => {
    it('returns null for a non-existent id', async () => {
      await seedUser('u1');
      expect(listingsStorage.getListingById('nope', 'u1')).toBeNull();
    });

    it('returns the listing with job_name attached', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1', { name: 'Berlin Search' });
      const items = [makeListing('detail')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      const result = listingsStorage.getListingById(items[0].id, 'u1');
      expect(result.job_name).toBe('Berlin Search');
      expect(result.title).toBe('Flat detail');
    });

    it('respects user scoping -- non-owner cannot fetch', async () => {
      await seedUser('owner');
      await seedUser('stranger');
      seedJob('j1', 'owner');
      const items = [makeListing('secret')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      expect(listingsStorage.getListingById(items[0].id, 'stranger')).toBeNull();
      expect(listingsStorage.getListingById(items[0].id, 'owner')).not.toBeNull();
    });
  });

  // ── deleteListingsById (soft delete) ───────────────────────────────────────

  describe('deleteListingsById (soft delete)', () => {
    it('soft-deleted listing disappears from queryListings', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('del-1'), makeListing('del-2')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);

      const result = listingsStorage.queryListings({ userId: 'u1' });
      expect(result.totalNumber).toBe(1);
      expect(result.result[0].hash).toBe('del-2');
    });

    it('CRITICAL: soft-deleted listing hash STAYS in getKnownListingHashesForJobAndProvider (tombstone prevents re-notification)', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('tombstone')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);

      const hashes = listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout');
      expect(hashes).toContain('tombstone');
    });

    it('soft-deleted listing is visible via hiddenOnly', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('hidden')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);

      const hidden = listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' });
      expect(hidden.totalNumber).toBe(1);
    });
  });

  // ── restoreListingsById ────────────────────────────────────────────────────

  describe('restoreListingsById', () => {
    it('brings a soft-deleted listing back into queryListings', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('restore-me')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);
      expect(listingsStorage.queryListings({ userId: 'u1' }).totalNumber).toBe(0);

      listingsStorage.restoreListingsById([items[0].id]);
      expect(listingsStorage.queryListings({ userId: 'u1' }).totalNumber).toBe(1);
    });

    it('restored listing is no longer in hiddenOnly view', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('toggle')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id]);
      listingsStorage.restoreListingsById([items[0].id]);

      expect(listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' }).totalNumber).toBe(0);
    });
  });

  // ── deleteListingsById (hard delete) ───────────────────────────────────────

  describe('deleteListingsById (hard delete)', () => {
    it('hard-deleted listing is completely gone from all queries', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('gone-forever')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      listingsStorage.deleteListingsById([items[0].id], true);

      expect(listingsStorage.queryListings({ userId: 'u1' }).totalNumber).toBe(0);
      expect(listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' }).totalNumber).toBe(0);
      const hashes = listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout');
      expect(hashes).not.toContain('gone-forever');
    });
  });

  // ── deleteListingsByJobId ──────────────────────────────────────────────────

  describe('deleteListingsByJobId', () => {
    it('soft-deletes all listings for a job', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      seedJob('j2', 'u1');
      listingsStorage.storeListings('j1', 'immoscout', [makeListing('j1-a'), makeListing('j1-b')]);
      listingsStorage.storeListings('j2', 'immoscout', [makeListing('j2-a')]);

      listingsStorage.deleteListingsByJobId('j1');

      expect(listingsStorage.queryListings({ userId: 'u1' }).totalNumber).toBe(1);
      expect(listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' }).totalNumber).toBe(2);
    });

    it('hard-deletes all listings for a job when flag is set', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      listingsStorage.storeListings('j1', 'immoscout', [makeListing('j1-hd')]);

      listingsStorage.deleteListingsByJobId('j1', true);

      expect(listingsStorage.queryListings({ userId: 'u1' }).totalNumber).toBe(0);
      expect(listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1' }).totalNumber).toBe(0);
    });
  });

  // ── deleteInactiveListingsByJobId ──────────────────────────────────────────

  describe('deleteInactiveListingsByJobId', () => {
    it('hard-deletes only inactive listings for a job, keeps active and unknown', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('active-one'), makeListing('to-deactivate')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      // Deactivate one listing
      listingsStorage.deactivateListings([items[1].id]);

      listingsStorage.deleteInactiveListingsByJobId('j1');

      // Active listing survives
      const remaining = listingsStorage.queryListings({ userId: 'u1' });
      expect(remaining.totalNumber).toBe(1);
      expect(remaining.result[0].hash).toBe('active-one');
    });
  });

  // ── chunking with >500 ids ─────────────────────────────────────────────────

  describe('chunking correctness with >500 ids', () => {
    const BATCH = 600; // above ID_CHUNK_SIZE (500)

    it('soft-deletes all listings in an oversized batch', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = Array.from({ length: BATCH }, (_, i) => makeListing(`chunk-${i}`));
      listingsStorage.storeListings('j1', 'immoscout', items);
      const ids = items.map((it) => it.id);

      listingsStorage.deleteListingsById(ids);

      const hidden = listingsStorage.queryListings({ hiddenOnly: true, userId: 'u1', isAdmin: true });
      expect(hidden.totalNumber).toBe(BATCH);
    });

    it('restores all listings in an oversized batch', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = Array.from({ length: BATCH }, (_, i) => makeListing(`restore-chunk-${i}`));
      listingsStorage.storeListings('j1', 'immoscout', items);
      const ids = items.map((it) => it.id);

      listingsStorage.deleteListingsById(ids);
      listingsStorage.restoreListingsById(ids);

      const result = listingsStorage.queryListings({ userId: 'u1', isAdmin: true });
      expect(result.totalNumber).toBe(BATCH);
    });

    it('hard-deletes all listings in an oversized batch', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = Array.from({ length: BATCH }, (_, i) => makeListing(`hard-chunk-${i}`));
      listingsStorage.storeListings('j1', 'immoscout', items);
      const ids = items.map((it) => it.id);

      listingsStorage.deleteListingsById(ids, true);

      const result = listingsStorage.queryListings({ userId: 'u1', isAdmin: true });
      expect(result.totalNumber).toBe(0);
    });
  });

  // ── filterListingIdsForUser / userCanAccessListing ─────────────────────────

  describe('filterListingIdsForUser', () => {
    it('returns only ids belonging to jobs the user owns', async () => {
      await seedUser('owner');
      await seedUser('other');
      seedJob('j-mine', 'owner');
      seedJob('j-theirs', 'other');

      const mine = [makeListing('my-listing')];
      const theirs = [makeListing('their-listing')];
      listingsStorage.storeListings('j-mine', 'immoscout', mine);
      listingsStorage.storeListings('j-theirs', 'immoscout', theirs);

      const allowed = listingsStorage.filterListingIdsForUser([mine[0].id, theirs[0].id], 'owner');
      expect(allowed).toEqual([mine[0].id]);
    });

    it('includes ids from shared jobs', async () => {
      await seedUser('owner');
      await seedUser('shared');
      seedJob('j-shared', 'owner', { shareWithUsers: ['shared'] });
      const items = [makeListing('shared-access')];
      listingsStorage.storeListings('j-shared', 'immoscout', items);

      const allowed = listingsStorage.filterListingIdsForUser([items[0].id], 'shared');
      expect(allowed).toEqual([items[0].id]);
    });

    it('admin sees everything', async () => {
      await seedUser('owner');
      await seedUser('admin', { isAdmin: true });
      seedJob('j1', 'owner');
      const items = [makeListing('admin-access')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      const allowed = listingsStorage.filterListingIdsForUser([items[0].id], 'admin', true);
      expect(allowed).toEqual([items[0].id]);
    });

    it('returns empty array for null/empty userId (non-admin)', async () => {
      expect(listingsStorage.filterListingIdsForUser(['some-id'], null)).toEqual([]);
      expect(listingsStorage.filterListingIdsForUser(['some-id'], '')).toEqual([]);
    });

    it('handles empty and non-array inputs', () => {
      expect(listingsStorage.filterListingIdsForUser([], 'u1')).toEqual([]);
      expect(listingsStorage.filterListingIdsForUser(null, 'u1')).toEqual([]);
    });

    it('deduplicates input ids', async () => {
      await seedUser('u1');
      seedJob('j1', 'u1');
      const items = [makeListing('dedup-me')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      const allowed = listingsStorage.filterListingIdsForUser([items[0].id, items[0].id, items[0].id], 'u1');
      expect(allowed).toHaveLength(1);
    });
  });

  describe('userCanAccessListing', () => {
    it('returns true for owner, false for stranger', async () => {
      await seedUser('owner');
      await seedUser('stranger');
      seedJob('j1', 'owner');
      const items = [makeListing('access-check')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      expect(listingsStorage.userCanAccessListing(items[0].id, 'owner')).toBe(true);
      expect(listingsStorage.userCanAccessListing(items[0].id, 'stranger')).toBe(false);
    });

    it('returns true for admin regardless of ownership', async () => {
      await seedUser('owner');
      await seedUser('admin', { isAdmin: true });
      seedJob('j1', 'owner');
      const items = [makeListing('admin-ok')];
      listingsStorage.storeListings('j1', 'immoscout', items);

      expect(listingsStorage.userCanAccessListing(items[0].id, 'admin', true)).toBe(true);
    });
  });
});
