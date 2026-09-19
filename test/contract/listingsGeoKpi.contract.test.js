/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: listingsStorage GEO / TRAVEL / KPI / CONNECTIVITY
 *
 * Backend-agnostic behavioral contract for distance, travel-time, KPI, and
 * connectivity operations. Seeds and asserts ONLY through the public storage
 * API. Must pass unchanged against every storage backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let listingsStorage, userStorage, jobStorage;

beforeAll(async () => {
  await initBackend();
  listingsStorage = await loadStorageModule('listingsStorage');
  userStorage = await loadStorageModule('userStorage');
  jobStorage = await loadStorageModule('jobStorage');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER = { userId: 'user-1', username: 'alice', password: 'pass', isAdmin: false };
const JOB = { jobId: 'job-1', name: 'Berlin flat', userId: USER.userId, provider: 'immoscout', dealType: 'rent' };

/** Seed a user + job, ready for listings. */
async function seedContext(userOverrides = {}, jobOverrides = {}) {
  const u = { ...USER, ...userOverrides };
  const j = { ...JOB, ...jobOverrides };
  await userStorage.upsertUser(u);
  await jobStorage.upsertJob(j);
  return { user: u, job: j };
}

let _seq = 0;
/** Build a listing object in the shape storeListings expects. */
function makeListing(overrides = {}) {
  const id = `hash-${_seq++}`;
  return {
    id,
    title: overrides.title ?? `Flat ${id}`,
    price: overrides.price ?? 1000,
    size: overrides.size ?? '70',
    rooms: overrides.rooms ?? '3',
    address: overrides.address ?? 'Somestr. 1, Berlin',
    link: overrides.link ?? `https://example.com/${id}`,
    description: overrides.description ?? 'Nice flat',
    image: overrides.image ?? null,
    latitude: overrides.latitude ?? 52.52,
    longitude: overrides.longitude ?? 13.405,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

describe('listingsStorage contract – distances', () => {
  it('round-trips distances through update + get', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const distances = [
      { label: 'Home', meters: 1234 },
      { label: 'Work', meters: 5678 },
    ];
    await listingsStorage.updateListingDistances(listing.id, distances);

    // getListingById returns the parsed listing with distances.
    const row = await listingsStorage.getListingById(listing.id, USER.userId, true);
    expect(row.distances).toEqual(distances);
  });

  it('getListingsToCalculateDistance returns listings without distances', async () => {
    await seedContext();
    const withCoords = makeListing({ latitude: 52.52, longitude: 13.405 });
    const noCoords = makeListing({ latitude: null, longitude: null });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [withCoords, noCoords]);

    const due = await listingsStorage.getListingsToCalculateDistance(JOB.jobId);
    const dueIds = due.map((r) => r.id);
    expect(dueIds).toContain(withCoords.id);
    expect(dueIds).not.toContain(noCoords.id);
  });

  it('getListingsToCalculateDistance excludes listings that already have distances', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);
    await listingsStorage.updateListingDistances(listing.id, [{ label: 'X', meters: 100 }]);

    const due = await listingsStorage.getListingsToCalculateDistance(JOB.jobId);
    expect(due.map((r) => r.id)).not.toContain(listing.id);
  });

  it('getListingsForUserToCalculateDistance returns listings across all user jobs', async () => {
    await seedContext();
    await jobStorage.upsertJob({ ...JOB, jobId: 'job-2', name: 'Munich flat' });
    const l1 = makeListing();
    const l2 = makeListing();
    await listingsStorage.storeListings('job-1', 'immoscout', [l1]);
    await listingsStorage.storeListings('job-2', 'immoscout', [l2]);

    const due = await listingsStorage.getListingsForUserToCalculateDistance(USER.userId);
    const ids = due.map((r) => r.id);
    expect(ids).toContain(l1.id);
    expect(ids).toContain(l2.id);
  });
});

// ---------------------------------------------------------------------------
// Travel Times
// ---------------------------------------------------------------------------

describe('listingsStorage contract – travel times', () => {
  it('save + get round-trips travel times for a listing', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const entries = [
      {
        label: 'Home',
        originLat: 52.5,
        originLng: 13.4,
        transitMinutes: 25,
        transitTransfers: 1,
        carMinutes: 15,
        carDistanceMeters: 8000,
        bikeMinutes: 30,
        walkMinutes: 60,
        estimateMode: 'transit',
        isEstimate: false,
        referenceTime: 1700000000,
      },
    ];

    await listingsStorage.saveListingTravelTimes(listing.id, entries, 5000);

    const map = await listingsStorage.getTravelTimesForListings([listing.id]);
    expect(map.has(listing.id)).toBe(true);
    const stored = map.get(listing.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe('Home');
    expect(stored[0].transit_minutes).toBe(25);
    expect(stored[0].car_minutes).toBe(15);
    expect(stored[0].bike_minutes).toBe(30);
    expect(stored[0].walk_minutes).toBe(60);
    expect(stored[0].is_estimate).toBe(0);
  });

  it('saveListingTravelTimes replaces old labels (delete-then-upsert)', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    // First save with Home + Work.
    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [
        { label: 'Home', originLat: 52, originLng: 13, transitMinutes: 20, isEstimate: true, referenceTime: 1000 },
        { label: 'Work', originLat: 53, originLng: 14, transitMinutes: 40, isEstimate: true, referenceTime: 1000 },
      ],
      1000,
    );

    // Second save with only Home (different value) — Work should be deleted.
    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [{ label: 'Home', originLat: 52, originLng: 13, transitMinutes: 10, isEstimate: false, referenceTime: 2000 }],
      2000,
    );

    const map = await listingsStorage.getTravelTimesForListings([listing.id]);
    const stored = map.get(listing.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe('Home');
    expect(stored[0].transit_minutes).toBe(10);
  });

  it('saveListingTravelTimes with empty entries deletes all rows', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [{ label: 'Home', originLat: 52, originLng: 13, transitMinutes: 20, isEstimate: true, referenceTime: 1000 }],
      1000,
    );

    await listingsStorage.saveListingTravelTimes(listing.id, [], 2000);

    const map = await listingsStorage.getTravelTimesForListings([listing.id]);
    expect(map.has(listing.id)).toBe(false);
  });

  it('attachTravelTimes decorates listing rows in-place', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [
        {
          label: 'Work',
          originLat: 52,
          originLng: 13,
          transitMinutes: 15,
          carMinutes: 10,
          estimateMode: 'transit',
          isEstimate: false,
          referenceTime: 1000,
        },
      ],
      1000,
    );

    const rows = [{ id: listing.id }];
    const result = await listingsStorage.attachTravelTimes(rows);
    expect(result[0].travelTimes).toHaveLength(1);
    expect(result[0].travelTimes[0].label).toBe('Work');
    expect(result[0].travelTimes[0].transit.minutes).toBe(15);
    expect(result[0].travelTimes[0].car.minutes).toBe(10);
    expect(result[0].travelTimes[0].estimate).toBe(false);
  });

  it('attachTravelTimes leaves listings without travel times unchanged', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const rows = [{ id: listing.id }];
    const result = await listingsStorage.attachTravelTimes(rows);
    expect(result[0].travelTimes).toBeUndefined();
  });

  it('getTravelTimesForListings returns empty map for empty input', async () => {
    const map = await listingsStorage.getTravelTimesForListings([]);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Travel time failure counter
// ---------------------------------------------------------------------------

describe('listingsStorage contract – travel time failures', () => {
  it('recordTravelTimeFailure increments the counter', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    await listingsStorage.recordTravelTimeFailure(listing.id, 1000);
    await listingsStorage.recordTravelTimeFailure(listing.id, 2000);

    // After 2 failures, listing still qualifies (limit is 5).
    const due = await listingsStorage.getListingsDueForTravelTimes({ staleBefore: 3000, limit: 100 });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });

  it('listing drops from travel time queue after reaching failure limit', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const limit = listingsStorage.TRAVEL_TIME_FAILURE_LIMIT;
    for (let i = 0; i < limit; i++) {
      await listingsStorage.recordTravelTimeFailure(listing.id, 1000 + i);
    }

    // Must not appear even with a generous staleBefore.
    const due = await listingsStorage.getListingsDueForTravelTimes({ staleBefore: Date.now() + 100000, limit: 100 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);
  });

  it('saveListingTravelTimes resets the failure counter', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    // Accumulate 3 failures.
    for (let i = 0; i < 3; i++) await listingsStorage.recordTravelTimeFailure(listing.id, 1000);

    // Save a successful result.
    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [{ label: 'Home', originLat: 52, originLng: 13, transitMinutes: 10, isEstimate: true, referenceTime: 2000 }],
      2000,
    );

    // Should be due again (failures reset to 0, but travel_times_at is stamped).
    const due = await listingsStorage.getListingsDueForTravelTimes({ staleBefore: 3000, limit: 100 });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });
});

// ---------------------------------------------------------------------------
// markTravelTimesDirty
// ---------------------------------------------------------------------------

describe('listingsStorage contract – markTravelTimesDirty', () => {
  it('puts previously computed listings back in the travel-time queue', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    // Save travel times (stamps travel_times_at).
    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [{ label: 'Home', originLat: 52, originLng: 13, transitMinutes: 20, isEstimate: true, referenceTime: 1000 }],
      1000,
    );

    // Should NOT be due immediately (stamped at 1000, staleBefore=0 by default).
    let due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);

    // Mark dirty.
    await listingsStorage.markTravelTimesDirty([listing.id]);

    // Should now be due (travel_times_at cleared to NULL).
    due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });

  it('resets failure counter alongside the timestamp', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    // Max out failures.
    for (let i = 0; i < listingsStorage.TRAVEL_TIME_FAILURE_LIMIT; i++) {
      await listingsStorage.recordTravelTimeFailure(listing.id, 1000);
    }

    // Not due after maxing out.
    let due = await listingsStorage.getListingsDueForTravelTimes({ staleBefore: Date.now() + 100000, limit: 100 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);

    // Mark dirty resets both counters.
    await listingsStorage.markTravelTimesDirty([listing.id]);

    due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });
});

// ---------------------------------------------------------------------------
// getListingsDueForTravelTimes
// ---------------------------------------------------------------------------

describe('listingsStorage contract – getListingsDueForTravelTimes', () => {
  it('returns listings with coords that have never been computed', async () => {
    await seedContext();
    const listing = makeListing({ latitude: 52.52, longitude: 13.405 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });

  it('skips listings with no coords', async () => {
    await seedContext();
    const listing = makeListing({ latitude: null, longitude: null });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);
  });

  it('skips -1/-1 marker coordinates', async () => {
    await seedContext();
    const listing = makeListing({ latitude: -1, longitude: -1 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);
  });

  it('includes the user_id from the owning job', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const due = await listingsStorage.getListingsDueForTravelTimes({ limit: 100 });
    const row = due.find((r) => r.id === listing.id);
    expect(row).toBeDefined();
    expect(row.user_id).toBe(USER.userId);
  });
});

// ---------------------------------------------------------------------------
// Map query
// ---------------------------------------------------------------------------

describe('listingsStorage contract – getListingsForMap', () => {
  it('returns listings with valid coordinates', async () => {
    await seedContext();
    const located = makeListing({ latitude: 52.52, longitude: 13.405 });
    const unlocated = makeListing({ latitude: null, longitude: null });
    const marker = makeListing({ latitude: -1, longitude: -1 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [located, unlocated, marker]);

    const { listings } = await listingsStorage.getListingsForMap({ isAdmin: true });
    const ids = listings.map((l) => l.id);
    expect(ids).toContain(located.id);
    expect(ids).not.toContain(unlocated.id);
    expect(ids).not.toContain(marker.id);
  });

  it('excludes inactive and soft-deleted listings', async () => {
    await seedContext();
    const active = makeListing();
    const inactive = makeListing();
    const deleted = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [active, inactive, deleted]);
    await listingsStorage.deactivateListings([inactive.id]);
    await listingsStorage.deleteListingsById([deleted.id]);

    const { listings } = await listingsStorage.getListingsForMap({ isAdmin: true });
    const ids = listings.map((l) => l.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(deleted.id);
  });

  it('attaches travel times to map listings', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);
    await listingsStorage.saveListingTravelTimes(
      listing.id,
      [{ label: 'Office', originLat: 52, originLng: 13, transitMinutes: 12, isEstimate: true, referenceTime: 1000 }],
      1000,
    );

    const { listings } = await listingsStorage.getListingsForMap({ isAdmin: true });
    const row = listings.find((l) => l.id === listing.id);
    expect(row.travelTimes).toHaveLength(1);
    expect(row.travelTimes[0].label).toBe('Office');
  });

  it('scopes results to jobs accessible by user', async () => {
    await seedContext();
    await userStorage.upsertUser({ userId: 'user-2', username: 'bob', password: 'pw', isAdmin: false });
    await jobStorage.upsertJob({ ...JOB, jobId: 'job-2', name: 'Bob flat', userId: 'user-2' });
    const mine = makeListing();
    const theirs = makeListing();
    await listingsStorage.storeListings('job-1', 'immoscout', [mine]);
    await listingsStorage.storeListings('job-2', 'immoscout', [theirs]);

    const { listings } = await listingsStorage.getListingsForMap({ userId: USER.userId });
    const ids = listings.map((l) => l.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
});

// ---------------------------------------------------------------------------
// KPI aggregates
// ---------------------------------------------------------------------------

describe('listingsStorage contract – KPI aggregates', () => {
  it('returns zeros for empty job list', async () => {
    expect(await listingsStorage.getListingsKpisForJobIds([])).toEqual({
      numberOfActiveListings: 0,
      medianPriceOfListings: 0,
    });
  });

  it('counts only active, non-deleted listings', async () => {
    await seedContext();
    const a1 = makeListing({ price: 1000 });
    const a2 = makeListing({ price: 1100 });
    const inact = makeListing({ price: 1200 });
    const del = makeListing({ price: 1300 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [a1, a2, inact, del]);
    await listingsStorage.deactivateListings([inact.id]);
    await listingsStorage.deleteListingsById([del.id]);

    const kpis = await listingsStorage.getListingsKpisForJobIds([JOB.jobId]);
    expect(kpis.numberOfActiveListings).toBe(2);
  });

  it('computes correct median for odd count', async () => {
    await seedContext();
    for (const p of [900, 1100, 1500]) {
      await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing({ price: p })]);
    }
    expect((await listingsStorage.getListingsKpisForJobIds([JOB.jobId])).medianPriceOfListings).toBe(1100);
  });

  it('computes correct median for even count (average of two middle)', async () => {
    await seedContext();
    for (const p of [900, 1000, 1200, 1500]) {
      await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing({ price: p })]);
    }
    expect((await listingsStorage.getListingsKpisForJobIds([JOB.jobId])).medianPriceOfListings).toBe(1100);
  });

  it('includes inactive listings in median but counts only active for numberOfActiveListings', async () => {
    await seedContext();
    const l1 = makeListing({ price: 1000 });
    const l2 = makeListing({ price: 3000 });
    const l3 = makeListing({ price: 2000 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [l1, l2, l3]);
    await listingsStorage.deactivateListings([l2.id]);

    const kpis = await listingsStorage.getListingsKpisForJobIds([JOB.jobId]);
    expect(kpis.numberOfActiveListings).toBe(2);
    // Median includes the inactive listing's price.
    expect(kpis.medianPriceOfListings).toBe(2000);
  });

  it('ignores listings without a price for median', async () => {
    await seedContext();
    for (const p of [1000, 2000, 3000]) {
      await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing({ price: p })]);
    }
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing({ price: null })]);
    expect((await listingsStorage.getListingsKpisForJobIds([JOB.jobId])).medianPriceOfListings).toBe(2000);
  });

  it('spans multiple jobs', async () => {
    await seedContext();
    await jobStorage.upsertJob({ ...JOB, jobId: 'job-2', name: 'Second' });
    for (const p of [1000, 1200]) {
      await listingsStorage.storeListings('job-1', 'immoscout', [makeListing({ price: p })]);
    }
    for (const p of [1400, 1600, 1800]) {
      await listingsStorage.storeListings('job-2', 'immoscout', [makeListing({ price: p })]);
    }

    const kpis = await listingsStorage.getListingsKpisForJobIds(['job-1', 'job-2']);
    expect(kpis.numberOfActiveListings).toBe(5);
    expect(kpis.medianPriceOfListings).toBe(1400);
  });
});

// ---------------------------------------------------------------------------
// Per-day buckets
// ---------------------------------------------------------------------------

describe('listingsStorage contract – listings per day', () => {
  const NOW = new Date('2026-07-25T12:00:00').getTime();

  it('returns one entry per day, oldest first', async () => {
    await seedContext();
    const result = await listingsStorage.getListingsPerDayForJobIds([JOB.jobId], 14, NOW);
    expect(result).toHaveLength(14);
    expect(result[0].date).toBe('2026-07-12');
    expect(result[13].date).toBe('2026-07-25');
  });

  it('returns full series of zeroes when no listings exist', async () => {
    await seedContext();
    const result = await listingsStorage.getListingsPerDayForJobIds([JOB.jobId], 14, NOW);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it('returns full zero series for empty job list without querying', async () => {
    const result = await listingsStorage.getListingsPerDayForJobIds([], 14, NOW);
    expect(result).toHaveLength(14);
    expect(result.every((r) => r.count === 0)).toBe(true);
  });

  it('counts listings created today into the last bucket', async () => {
    await seedContext();
    // Store listings now; their created_at will be Date.now() which maps to "today".
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing(), makeListing()]);

    const now = Date.now();
    const result = await listingsStorage.getListingsPerDayForJobIds([JOB.jobId], 14, now);
    const todayKey = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${d.getFullYear()}-${m}-${day}`;
    })();

    const todayBucket = result.find((r) => r.date === todayKey);
    expect(todayBucket).toBeDefined();
    expect(todayBucket.count).toBe(2);
  });

  it('ignores soft-deleted listings', async () => {
    await seedContext();
    const kept = makeListing();
    const deleted = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [kept, deleted]);
    await listingsStorage.deleteListingsById([deleted.id]);

    const result = await listingsStorage.getListingsPerDayForJobIds([JOB.jobId], 14, Date.now());
    const total = result.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(1);
  });

  it('honours a shorter window', async () => {
    await seedContext();
    const result = await listingsStorage.getListingsPerDayForJobIds([JOB.jobId], 7, NOW);
    expect(result).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Provider distribution
// ---------------------------------------------------------------------------

describe('listingsStorage contract – provider distribution', () => {
  it('returns empty array for empty job list', async () => {
    expect(await listingsStorage.getProviderDistributionForJobIds([])).toEqual([]);
  });

  it('computes percentage distribution across providers', async () => {
    await seedContext();
    // 3 immoscout + 1 immowelt = 75% + 25%.
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing(), makeListing(), makeListing()]);
    await listingsStorage.storeListings(JOB.jobId, 'immowelt', [makeListing()]);

    const dist = await listingsStorage.getProviderDistributionForJobIds([JOB.jobId]);
    expect(dist).toHaveLength(2);

    const immoscout = dist.find((d) => d.type === 'immoscout');
    const immowelt = dist.find((d) => d.type === 'immowelt');
    expect(immoscout.value).toBe(75);
    expect(immowelt.value).toBe(25);
  });

  it('percentages sum to 100', async () => {
    await seedContext();
    // 3 providers, uneven split.
    await listingsStorage.storeListings(JOB.jobId, 'a', [makeListing(), makeListing(), makeListing()]);
    await listingsStorage.storeListings(JOB.jobId, 'b', [makeListing(), makeListing()]);
    await listingsStorage.storeListings(JOB.jobId, 'c', [makeListing()]);

    const dist = await listingsStorage.getProviderDistributionForJobIds([JOB.jobId]);
    const total = dist.reduce((sum, d) => sum + d.value, 0);
    expect(total).toBe(100);
  });

  it('excludes soft-deleted listings', async () => {
    await seedContext();
    const kept = makeListing();
    const deleted = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [kept, deleted]);
    await listingsStorage.deleteListingsById([deleted.id]);

    const dist = await listingsStorage.getProviderDistributionForJobIds([JOB.jobId]);
    expect(dist).toHaveLength(1);
    expect(dist[0].value).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Available providers
// ---------------------------------------------------------------------------

describe('listingsStorage contract – getAvailableProviders', () => {
  it('returns distinct providers for accessible jobs', async () => {
    await seedContext();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [makeListing()]);
    await listingsStorage.storeListings(JOB.jobId, 'immowelt', [makeListing()]);

    const providers = await listingsStorage.getAvailableProviders({ userId: USER.userId });
    expect(providers).toContain('immoscout');
    expect(providers).toContain('immowelt');
  });

  it('excludes soft-deleted listings by default', async () => {
    await seedContext();
    const kept = makeListing();
    const deleted = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [kept]);
    await listingsStorage.storeListings(JOB.jobId, 'onlythis', [deleted]);
    await listingsStorage.deleteListingsById([deleted.id]);

    const providers = await listingsStorage.getAvailableProviders({ userId: USER.userId });
    expect(providers).toContain('immoscout');
    expect(providers).not.toContain('onlythis');
  });

  it('shows only soft-deleted providers with hiddenOnly', async () => {
    await seedContext();
    const kept = makeListing();
    const deleted = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [kept]);
    await listingsStorage.storeListings(JOB.jobId, 'onlythis', [deleted]);
    await listingsStorage.deleteListingsById([deleted.id]);

    const providers = await listingsStorage.getAvailableProviders({ userId: USER.userId, hiddenOnly: true });
    expect(providers).toContain('onlythis');
    expect(providers).not.toContain('immoscout');
  });
});

// ---------------------------------------------------------------------------
// Connectivity enrichment
// ---------------------------------------------------------------------------

describe('listingsStorage contract – connectivity', () => {
  it('getListingsToEnrichConnectivity returns unenriched geocoded listings', async () => {
    await seedContext();
    const geocoded = makeListing({ latitude: 52.52, longitude: 13.405 });
    const noCoords = makeListing({ latitude: null, longitude: null });
    const marker = makeListing({ latitude: -1, longitude: -1 });
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [geocoded, noCoords, marker]);

    const due = await listingsStorage.getListingsToEnrichConnectivity({
      limit: 100,
      maxAgeDays: 180,
      now: Date.now(),
    });
    const ids = due.map((r) => r.id);
    expect(ids).toContain(geocoded.id);
    expect(ids).not.toContain(noCoords.id);
    expect(ids).not.toContain(marker.id);
  });

  it('round-trips connectivity through update + getListingById', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    const connectivity = { maxDownMbit: 1000, fiber: true, source: 'de-bba' };
    await listingsStorage.updateListingConnectivity(
      listing.id,
      connectivity,
      { maxDown: 1000, fiber: 1, mobile: 6 },
      5000,
    );

    const row = await listingsStorage.getListingById(listing.id, USER.userId, true);
    expect(row.connectivity).toEqual(connectivity);
  });

  it('stamped enrichment removes listing from connectivity queue', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);

    await listingsStorage.updateListingConnectivity(
      listing.id,
      null,
      { maxDown: null, fiber: null, mobile: null },
      5000,
    );

    const due = await listingsStorage.getListingsToEnrichConnectivity({ limit: 100, maxAgeDays: 180, now: 5000 });
    expect(due.map((r) => r.id)).not.toContain(listing.id);
  });

  it('stale enrichment re-enters the queue', async () => {
    await seedContext();
    const listing = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [listing]);
    await listingsStorage.updateListingConnectivity(
      listing.id,
      null,
      { maxDown: null, fiber: null, mobile: null },
      1000,
    );

    const DAY = 24 * 60 * 60 * 1000;
    const due = await listingsStorage.getListingsToEnrichConnectivity({ limit: 100, maxAgeDays: 30, now: 120 * DAY });
    expect(due.map((r) => r.id)).toContain(listing.id);
  });

  it('connectivity columns power queryListings filters (bitmask, fiber, minDown)', async () => {
    await seedContext();
    const fiber = makeListing();
    const cable = makeListing();
    const slow = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [fiber, cable, slow]);

    await listingsStorage.updateListingConnectivity(fiber.id, {}, { maxDown: 1000, fiber: 1, mobile: 0 }, 1);
    await listingsStorage.updateListingConnectivity(cable.id, {}, { maxDown: 1000, fiber: 0, mobile: 0 }, 1);
    await listingsStorage.updateListingConnectivity(slow.id, {}, { maxDown: 50, fiber: 0, mobile: 0 }, 1);

    // Fiber filter.
    let result = await listingsStorage.queryListings({ isAdmin: true, connectivityFiberOnly: true });
    expect(result.result.map((r) => r.id)).toEqual([fiber.id]);

    // Speed floor.
    result = await listingsStorage.queryListings({ isAdmin: true, connectivityMinDown: 100 });
    const ids = result.result.map((r) => r.id);
    expect(ids).toContain(fiber.id);
    expect(ids).toContain(cable.id);
    expect(ids).not.toContain(slow.id);
  });

  it('skips inactive and hidden listings from enrichment queue', async () => {
    await seedContext();
    const active = makeListing();
    const inactive = makeListing();
    const hidden = makeListing();
    await listingsStorage.storeListings(JOB.jobId, 'immoscout', [active, inactive, hidden]);
    await listingsStorage.deactivateListings([inactive.id]);
    await listingsStorage.deleteListingsById([hidden.id]);

    const due = await listingsStorage.getListingsToEnrichConnectivity({
      limit: 100,
      maxAgeDays: 180,
      now: Date.now(),
    });
    const ids = due.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(hidden.id);
  });
});
