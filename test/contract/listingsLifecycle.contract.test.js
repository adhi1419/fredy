/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: listingsStorage LIFECYCLE behaviors
 *
 * Active-check failure tracking, deactivation/reactivation flow, retention
 * purge, price observation + change + history, geocode candidates, and the
 * notes/status/address setters.
 *
 * Backend-agnostic: seeds and asserts ONLY through the public storage API.
 * Must pass unchanged against every storage backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let listingsStorage;
let userStorage;
let jobStorage;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

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

// ---------------------------------------------------------------------------
// Helpers — seed exclusively through the public API
// ---------------------------------------------------------------------------

const seedUser = async (userId = 'u1') => {
  await userStorage.upsertUser({ username: `user-${userId}`, password: 'pass', userId, isAdmin: false });
  return userId;
};

const seedJob = (jobId = 'job-1', userId = 'u1') => {
  jobStorage.upsertJob({
    jobId,
    name: `Job ${jobId}`,
    userId,
    provider: JSON.stringify([{ id: 'immoscout', enabled: true }]),
    notificationAdapter: '[]',
  });
  return jobId;
};

let listingSeq = 0;
const seedListing = (jobId, overrides = {}) => {
  const seq = ++listingSeq;
  const hash = overrides.hash || `hash-${seq}-${Date.now()}`;
  const listing = {
    id: hash,
    title: overrides.title || `Flat ${seq}`,
    address: overrides.address || `Street ${seq}, Berlin`,
    price: overrides.price ?? '1000',
    size: overrides.size || '70',
    rooms: overrides.rooms || '3',
    link: overrides.link || `https://example.com/${seq}`,
    image: overrides.image || null,
    description: overrides.description || `Description ${seq}`,
    latitude: overrides.latitude || null,
    longitude: overrides.longitude || null,
  };
  listingsStorage.storeListings(jobId, 'immoscout', [listing]);
  // storeListings mutates item.id to the DB row id
  return listing.id;
};

// ---------------------------------------------------------------------------
// Active-check lifecycle
// ---------------------------------------------------------------------------
describe('listingsStorage lifecycle contract', () => {
  describe('active-check: failure counter and deactivation', () => {
    it('newly stored listing is due for active check (never checked)', async () => {
      await seedUser();
      seedJob();
      seedListing('job-1');

      const due = listingsStorage.getListingsDueForActiveCheck({ now: NOW });
      expect(due.length).toBe(1);
      expect(due[0]).toHaveProperty('id');
      expect(due[0]).toHaveProperty('link');
      expect(due[0]).toHaveProperty('provider');
    });

    it('markListingsChecked takes a listing out of the due set', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.markListingsChecked([id], NOW);

      const due = listingsStorage.getListingsDueForActiveCheck({
        now: NOW,
        staleAfterMs: 7 * DAY,
      });
      expect(due.map((r) => r.id)).not.toContain(id);
    });

    it('markListingsChecked resets the failure counter', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      // Accumulate some failures
      listingsStorage.recordActiveCheckFailures([id], { checkedAt: NOW - 3 * DAY });
      listingsStorage.recordActiveCheckFailures([id], { checkedAt: NOW - 2 * DAY });

      // Definitive answer clears the streak
      listingsStorage.markListingsChecked([id], NOW);

      // One more failure should not exhaust immediately
      const exhausted = listingsStorage.recordActiveCheckFailures([id], {
        checkedAt: NOW + DAY,
        failureLimit: 2,
      });
      expect(exhausted).toEqual([]);
    });

    it('recordActiveCheckFailures increments counter and reports exhausted ids', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      // With failureLimit=3, the third failure should exhaust
      listingsStorage.recordActiveCheckFailures([id], { checkedAt: NOW - 2 * DAY, failureLimit: 3 });
      listingsStorage.recordActiveCheckFailures([id], { checkedAt: NOW - DAY, failureLimit: 3 });
      const exhausted = listingsStorage.recordActiveCheckFailures([id], {
        checkedAt: NOW,
        failureLimit: 3,
      });

      expect(exhausted).toContain(id);
    });

    it('failures below the limit do not exhaust', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      const exhausted = listingsStorage.recordActiveCheckFailures([id], {
        checkedAt: NOW,
        failureLimit: 3,
      });

      expect(exhausted).toEqual([]);
    });

    it('deactivateListings marks listing inactive and stamps inactive_since', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.is_active).toBe(0);
    });

    it('deactivated listing is excluded from active-check due set', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);

      const due = listingsStorage.getListingsDueForActiveCheck({ now: NOW + DAY });
      expect(due.map((r) => r.id)).not.toContain(id);
    });

    it('full failure-to-deactivation flow', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');
      const LIMIT = 3;

      // Accumulate failures to exhaustion
      for (let i = 0; i < LIMIT - 1; i++) {
        listingsStorage.recordActiveCheckFailures([id], {
          checkedAt: NOW + i * DAY,
          failureLimit: LIMIT,
        });
      }
      const exhausted = listingsStorage.recordActiveCheckFailures([id], {
        checkedAt: NOW + (LIMIT - 1) * DAY,
        failureLimit: LIMIT,
      });
      expect(exhausted).toContain(id);

      // Deactivate the exhausted listing
      listingsStorage.deactivateListings(exhausted, NOW + LIMIT * DAY);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.is_active).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Reactivation
  // ---------------------------------------------------------------------------
  describe('reactivation', () => {
    it('reactivateListings restores an inactive listing and sets activity_is_manual', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);
      listingsStorage.reactivateListings([id]);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.is_active).toBe(1);
      // activity_is_manual = 1 means the alive-checker won't re-check it
      expect(listing.activity_is_manual).toBe(1);
    });

    it('reactivated listing is excluded from active-check due set (manual override)', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);
      listingsStorage.reactivateListings([id]);

      const due = listingsStorage.getListingsDueForActiveCheck({ now: NOW + 30 * DAY });
      expect(due.map((r) => r.id)).not.toContain(id);
    });

    it('reactivation skips soft-deleted listings', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      // Soft-delete then deactivate
      listingsStorage.deleteListingsById([id], false);

      listingsStorage.reactivateListings([id]);

      // Should still be manually_deleted
      const listing = listingsStorage.getListingById(id, 'u1', true);
      // getListingById filters manually_deleted=0, so it returns null for deleted listings
      expect(listing).toBeNull();
    });

    it('does nothing on an empty id list', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);
      listingsStorage.reactivateListings([]);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.is_active).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Retention purge
  // ---------------------------------------------------------------------------
  describe('purgeExpiredInactiveListings', () => {
    const purge = (retentionDays = 14) => listingsStorage.purgeExpiredInactiveListings({ retentionDays, now: NOW });

    it('deletes a listing that has been offline longer than the retention period', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW - 15 * DAY);

      expect(purge(14).changes).toBe(1);
      expect(listingsStorage.getListingById(id, 'u1', true)).toBeNull();
    });

    it('keeps a listing still inside its grace period', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW - 13 * DAY);

      expect(purge(14).changes).toBe(0);
    });

    it('never touches an active listing', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');
      // Listing stays active (default), purge should not touch it
      expect(purge(14).changes).toBe(0);
      expect(listingsStorage.getListingById(id, 'u1', true)).not.toBeNull();
    });

    it('never deletes a listing on the watch list', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW - 400 * DAY);

      // We need to add to watch list. watchListStorage is a separate module.
      const watchListStorage = await import('../../lib/services/storage/watchListStorage.js');
      watchListStorage.createWatch(id, 'u1');

      expect(purge(14).changes).toBe(0);
    });

    it('deletes nothing when retentionDays < 1', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');
      listingsStorage.deactivateListings([id], NOW - 400 * DAY);

      expect(purge(0).changes).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Price tracking
  // ---------------------------------------------------------------------------
  describe('price tracking', () => {
    it('never-checked listing is due for price check', async () => {
      await seedUser();
      seedJob();
      seedListing('job-1');

      const due = listingsStorage.getListingsDueForPriceCheck({ now: NOW });
      expect(due.length).toBe(1);
      expect(due[0]).toHaveProperty('price');
      expect(due[0]).toHaveProperty('job_id');
    });

    it('markListingsPriceChecked takes a listing out of the due set', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.markListingsPriceChecked([id], NOW);

      const due = listingsStorage.getListingsDueForPriceCheck({
        now: NOW,
        staleAfterMs: 7 * DAY,
      });
      expect(due.map((r) => r.id)).not.toContain(id);
    });

    it('inactive listings are excluded from price check', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.deactivateListings([id], NOW);

      const due = listingsStorage.getListingsDueForPriceCheck({ now: NOW });
      expect(due.map((r) => r.id)).not.toContain(id);
    });

    it('recordPriceObservation + applyPriceChange + getPriceHistory round-trip', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { price: '1200' });

      // Record an observation
      listingsStorage.recordPriceObservation(id, 1100, NOW, 'priceProbe');
      // Apply the price change
      listingsStorage.applyPriceChange(id, 1100, NOW);

      // Verify the listing's current price changed
      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.price).toBe(1100);
      expect(listing.previous_price).toBe(1200);

      // Verify history
      const history = listingsStorage.getPriceHistory(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        price: 1100,
        observed_at: NOW,
        source: 'priceProbe',
      });
    });

    it('history is returned oldest first', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.recordPriceObservation(id, 1000, NOW - 2 * DAY, 'a');
      listingsStorage.recordPriceObservation(id, 900, NOW, 'b');
      listingsStorage.recordPriceObservation(id, 950, NOW - DAY, 'c');

      const prices = listingsStorage.getPriceHistory(id).map((r) => r.price);
      expect(prices).toEqual([1000, 950, 900]);
    });

    it('rejects unusable prices (null, NaN)', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { price: '1200' });

      listingsStorage.recordPriceObservation(id, null, NOW);
      listingsStorage.applyPriceChange(id, NaN, NOW);

      expect(listingsStorage.getPriceHistory(id)).toEqual([]);
      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.price).toBe(1200);
    });

    it('prices are rounded to integers', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.recordPriceObservation(id, 999.7, NOW, 'x');
      listingsStorage.applyPriceChange(id, 999.7, NOW);

      const history = listingsStorage.getPriceHistory(id);
      expect(history[0].price).toBe(1000);
      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.price).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // Geocoding candidates
  // ---------------------------------------------------------------------------
  describe('geocoding candidates', () => {
    it('returns active listings with address but no coordinates', async () => {
      await seedUser();
      seedJob();
      seedListing('job-1', { address: 'Hauptstr. 1, Berlin' });

      const candidates = listingsStorage.getListingsToGeocode();
      expect(candidates.length).toBe(1);
      expect(candidates[0]).toHaveProperty('address', 'Hauptstr. 1, Berlin');
      expect(candidates[0]).toHaveProperty('provider', 'immoscout');
    });

    it('excludes listings that already have coordinates', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { address: 'Hauptstr. 1, Berlin' });

      // Simulate geocoding
      listingsStorage.updateListingGeocoordinates(id, 52.52, 13.405);

      const candidates = listingsStorage.getListingsToGeocode();
      expect(candidates.map((r) => r.id)).not.toContain(id);
    });

    it('excludes inactive listings', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { address: 'Hauptstr. 1, Berlin' });

      listingsStorage.deactivateListings([id], NOW);

      const candidates = listingsStorage.getListingsToGeocode();
      expect(candidates.map((r) => r.id)).not.toContain(id);
    });

    it('excludes manually deleted listings', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { address: 'Hauptstr. 1, Berlin' });

      listingsStorage.deleteListingsById([id], false);

      const candidates = listingsStorage.getListingsToGeocode();
      expect(candidates.map((r) => r.id)).not.toContain(id);
    });

    it('getGeocoordinatesByAddress returns coords for a geocoded listing', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1', { address: 'Marktplatz 5, Munich' });

      listingsStorage.updateListingGeocoordinates(id, 48.137, 11.575);

      const coords = listingsStorage.getGeocoordinatesByAddress('Marktplatz 5, Munich');
      expect(coords).toEqual({ lat: 48.137, lng: 11.575 });
    });

    it('getGeocoordinatesByAddress returns null for unknown address', () => {
      const coords = listingsStorage.getGeocoordinatesByAddress('Nonexistent 99, Nowhere');
      expect(coords).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Notes / status / address setters
  // ---------------------------------------------------------------------------
  describe('setListingNotes', () => {
    it('round-trips a note through set + getListingById', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingNotes(id, 'Great location, visited on Monday');

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.notes).toBe('Great location, visited on Monday');
    });

    it('clears a note when set to null', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingNotes(id, 'note');
      listingsStorage.setListingNotes(id, null);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.notes).toBeNull();
    });

    it('normalizes empty/whitespace strings to null', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingNotes(id, '   ');

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.notes).toBeNull();
    });
  });

  describe('setListingStatus', () => {
    it('round-trips a status through set + getListingById', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingStatus(id, 'applied');

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.status).toMatchObject({ status: 'applied' });
      expect(listing.status.setAt).toBeGreaterThan(0);
    });

    it('clears a status when set to null', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingStatus(id, 'rejected');
      listingsStorage.setListingStatus(id, null);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.status).toBeNull();
    });

    it('throws on invalid status values', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      expect(() => listingsStorage.setListingStatus(id, 'bogus')).toThrow('Invalid listing status');
    });

    it('accepts all three valid statuses', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      for (const status of ['applied', 'rejected', 'accepted']) {
        listingsStorage.setListingStatus(id, status);
        const listing = listingsStorage.getListingById(id, 'u1', true);
        expect(listing.status.status).toBe(status);
      }
    });
  });

  describe('setListingAddress', () => {
    it('round-trips an address with coordinates through set + getListingById', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingAddress(id, 'Alexanderplatz 1, Berlin', 52.521, 13.413);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.address).toBe('Alexanderplatz 1, Berlin');
      expect(listing.latitude).toBe(52.521);
      expect(listing.longitude).toBe(13.413);
      expect(listing.address_is_manual).toBe(1);
    });

    it('rejects blank address', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      const changes = listingsStorage.setListingAddress(id, '   ', 52.0, 13.0);
      expect(changes).toBe(0);
    });

    it('clears distances so they are recomputed from the new coordinates', async () => {
      await seedUser();
      seedJob();
      const id = seedListing('job-1');

      listingsStorage.setListingAddress(id, 'New Place 1', 48.0, 11.0);

      const listing = listingsStorage.getListingById(id, 'u1', true);
      expect(listing.distances).toBeNull();
    });
  });
});
