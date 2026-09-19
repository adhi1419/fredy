/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFirestoreMemory } from '../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));
vi.mock('../../lib/services/similarity-check/similarityCache.js', () => ({ removeEntry: vi.fn() }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: () => false }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({ demoMode: false }),
  getUserSettings: async () => ({}),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({
  toggleWatch: vi.fn(),
  ensureWatch: vi.fn(),
}));
vi.mock('../../lib/services/tracking/Tracker.js', () => ({ trackPoi: vi.fn() }));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: async () => null }));

const { filterListingIdsForUser, userCanAccessListing } = await import('../../lib/services/storage/listingsStorage.js');

const LISTINGS = {
  'mine-1': { owner: 'alice', sharedWith: [] },
  'mine-2': { owner: 'alice', sharedWith: [] },
  'shared-with-me': { owner: 'bob', sharedWith: ['alice'] },
  'someone-elses': { owner: 'bob', sharedWith: [] },
};

const seedListing = (id, { owner, sharedWith = [] }) => {
  const jobId = `job-${id}`;
  firestore.seed('jobs', jobId, { userId: owner, sharedWithUser: sharedWith });
  firestore.seed('listings', id, { jobId, isActive: true, manuallyDeleted: false });
};

const seedBase = () => {
  for (const [id, ownership] of Object.entries(LISTINGS)) seedListing(id, ownership);
};

describe('listing access control', () => {
  beforeEach(() => {
    firestore.clear();
  });

  describe('filterListingIdsForUser', () => {
    it('keeps listings the user owns', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['mine-1', 'mine-2'], 'alice')).toEqual(['mine-1', 'mine-2']);
    });

    it('keeps listings from a job shared with the user', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['shared-with-me'], 'alice')).toEqual(['shared-with-me']);
    });

    it('drops listings belonging to someone else', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['someone-elses'], 'alice')).toEqual([]);
    });

    it('drops unknown ids', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['does-not-exist'], 'alice')).toEqual([]);
    });

    it('returns only the accessible part of a mixed batch', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['mine-1', 'someone-elses', 'mine-2'], 'alice')).toEqual([
        'mine-1',
        'mine-2',
      ]);
    });

    it('lets an admin through without a query', async () => {
      expect(await filterListingIdsForUser(['someone-elses'], 'carol', true)).toEqual(['someone-elses']);
    });

    it('returns nothing without a user', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['mine-1'], null)).toEqual([]);
      expect(await filterListingIdsForUser(['mine-1'], undefined)).toEqual([]);
    });

    it('handles empty and malformed input', async () => {
      seedBase();
      expect(await filterListingIdsForUser([], 'alice')).toEqual([]);
      expect(await filterListingIdsForUser(null, 'alice')).toEqual([]);
      expect(await filterListingIdsForUser(['', null, 42], 'alice')).toEqual([]);
    });

    it('de-duplicates ids', async () => {
      seedBase();
      expect(await filterListingIdsForUser(['mine-1', 'mine-1'], 'alice')).toEqual(['mine-1']);
    });

    it('chunks a batch larger than the Firestore batch limit', async () => {
      firestore.seed('jobs', 'bulk-job', { userId: 'alice', sharedWithUser: [] });
      const ids = Array.from({ length: 1200 }, (_, i) => `bulk-${i}`);
      for (const id of ids)
        firestore.seed('listings', id, { jobId: 'bulk-job', isActive: true, manuallyDeleted: false });
      expect(await filterListingIdsForUser(ids, 'alice')).toHaveLength(1200);
    });
  });

  describe('userCanAccessListing', () => {
    it.each([
      ['mine-1', 'alice', false, true],
      ['shared-with-me', 'alice', false, true],
      ['someone-elses', 'alice', false, false],
      ['someone-elses', 'alice', true, true],
    ])('listing %s for %s (admin=%s) -> %s', async (id, userId, isAdmin, expected) => {
      seedBase();
      expect(await userCanAccessListing(id, userId, isAdmin)).toBe(expected);
    });
  });

  describe('listingsRouter guards', () => {
    let routes;

    const makeReply = () => ({
      statusCode: null,
      payload: undefined,
      code(c) {
        this.statusCode = c;
        return this;
      },
      send(p) {
        this.payload = p;
        return this;
      },
    });

    const requestFor = (userId, body = {}, params = {}) => ({
      currentUser: { id: userId, isAdmin: false },
      body,
      params,
      query: {},
    });

    beforeEach(async () => {
      seedBase();
      const plugin = (await import('../../lib/api/routes/listingsRouter.js')).default;
      routes = {};
      await plugin({
        get: (path, handler) => (routes[`GET ${path}`] = handler),
        post: (path, handler) => (routes[`POST ${path}`] = handler),
        delete: (path, handler) => (routes[`DELETE ${path}`] = handler),
      });
    });

    afterEach(() => {
      firestore.clear();
    });

    it('rejects notes on a foreign listing', async () => {
      const reply = makeReply();
      await routes['POST /:listingId/notes'](
        requestFor('alice', { notes: 'mine now' }, { listingId: 'someone-elses' }),
        reply,
      );
      expect(reply.statusCode).toBe(403);
    });

    it('allows notes on an own listing', async () => {
      const reply = makeReply();
      await routes['POST /:listingId/notes'](requestFor('alice', { notes: 'nice' }, { listingId: 'mine-1' }), reply);
      expect(reply.statusCode).toBeNull();
      expect(firestore.read('listings', 'mine-1').notes).toBe('nice');
    });

    it('rejects a status change on a foreign listing', async () => {
      const reply = makeReply();
      await routes['POST /:listingId/status'](
        requestFor('alice', { status: 'rejected' }, { listingId: 'someone-elses' }),
        reply,
      );
      expect(reply.statusCode).toBe(403);
    });

    it('rejects watching a foreign listing', async () => {
      const reply = makeReply();
      await routes['POST /watch'](requestFor('alice', { listingId: 'someone-elses' }), reply);
      expect(reply.statusCode).toBe(403);
    });

    it('rejects a batch delete that contains one foreign listing', async () => {
      const reply = makeReply();
      await routes['DELETE /'](requestFor('alice', { ids: ['mine-1', 'someone-elses'], hardDelete: true }), reply);
      expect(reply.statusCode).toBe(403);
      expect(firestore.read('listings', 'mine-1')).not.toBeUndefined();
    });

    it('allows a batch delete of only own listings', async () => {
      const reply = makeReply();
      await routes['DELETE /'](requestFor('alice', { ids: ['mine-1', 'mine-2'] }), reply);
      expect(reply.statusCode).toBeNull();
    });

    it('rejects a restore that contains a foreign listing', async () => {
      const reply = makeReply();
      await routes['POST /restore'](requestFor('alice', { ids: ['someone-elses'] }), reply);
      expect(reply.statusCode).toBe(403);
    });
  });
});
