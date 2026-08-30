/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: jobStorage
 *
 * Backend-agnostic behavioral contract for the jobs module. Seeds and asserts
 * ONLY through the public storage API. Must pass unchanged against every
 * storage backend (sqlite today, firestore in Phase 2).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let jobStorage;
let channelStorage;
let userStorage;
let listingsStorage;

beforeAll(async () => {
  await initBackend();
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
  channelStorage = await import('../../lib/services/storage/configuredAdapterStorage.js');
  userStorage = await import('../../lib/services/storage/userStorage.js');
  listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
});

beforeEach(async () => {
  await resetBackend();
  // jobs and configured_adapter have FK to users; seed a default user.
  await userStorage.upsertUser({ userId: 'u1', username: 'testuser', password: 'test123', isAdmin: false });
});

afterAll(async () => {
  await teardownBackend();
});

/* ── helpers ─────────────────────────────────────────────────────── */

const seedUser = async (id, username, isAdmin = false) =>
  userStorage.upsertUser({ userId: id, username, password: 'test123', isAdmin });

const makeJob = (overrides = {}) => ({
  userId: 'u1',
  name: 'Test Job',
  provider: [{ url: 'https://immoscout.de/mieten' }],
  notificationAdapter: [],
  enabled: true,
  ...overrides,
});

const seedChannel = (overrides = {}) =>
  channelStorage.upsertChannel({
    userId: 'u1',
    adapterId: 'telegram',
    name: 'Channel',
    fields: { token: 'tok', chatId: '123' },
    ...overrides,
  });

const seedListings = (jobId, providerId, hashes) =>
  listingsStorage.storeListings(
    jobId,
    providerId,
    hashes.map((h) => ({
      id: h,
      price: 800,
      size: 60,
      rooms: 2,
      title: `Listing ${h}`,
      image: null,
      description: 'desc',
      address: 'Berlin',
      link: `https://example.com/${h}`,
    })),
  );

/* ── tests ───────────────────────────────────────────────────────── */

describe('jobStorage contract', () => {
  describe('upsertJob insert', () => {
    it('creates a job retrievable by getJob', () => {
      jobStorage.upsertJob(makeJob({ name: 'New Job' }));
      const jobs = jobStorage.getJobs({ includeDisabled: true });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('New Job');
    });

    it('generates an id when jobId is not provided', () => {
      jobStorage.upsertJob(makeJob());
      const jobs = jobStorage.getJobs({ includeDisabled: true });
      expect(typeof jobs[0].id).toBe('string');
      expect(jobs[0].id.length).toBeGreaterThan(0);
    });

    it('uses the provided jobId when given', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'my-custom-id' }));
      const job = jobStorage.getJob('my-custom-id');
      expect(job).not.toBeNull();
      expect(job.id).toBe('my-custom-id');
    });

    it('defaults dealType to rent when omitted', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j-rent' }));
      expect(jobStorage.getJob('j-rent').dealType).toBe('rent');
    });

    it('persists an explicit buy dealType', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j-buy', dealType: 'buy' }));
      expect(jobStorage.getJob('j-buy').dealType).toBe('buy');
    });

    it('round-trips all fields: blacklist, provider, spatialFilter, specFilter, commuteFilter, shareWithUsers', () => {
      const spatialFilter = { type: 'FeatureCollection', features: [] };
      const specFilter = { maxPrice: 1200, minSize: 50 };
      const commuteFilter = { action: 'notify', limits: { Work: 35 } };
      jobStorage.upsertJob(
        makeJob({
          jobId: 'j-full',
          blacklist: ['bad-word'],
          shareWithUsers: ['u2', 'u3'],
          spatialFilter,
          specFilter,
          commuteFilter,
        }),
      );
      const job = jobStorage.getJob('j-full');
      expect(job.blacklist).toEqual(['bad-word']);
      expect(job.shared_with_user).toEqual(['u2', 'u3']);
      expect(job.spatialFilter).toEqual(spatialFilter);
      expect(job.specFilter).toEqual(specFilter);
      expect(job.commuteFilter).toEqual(commuteFilter);
    });
  });

  describe('upsertJob update', () => {
    it('preserves the original user_id when a different user updates', async () => {
      await seedUser('original-owner', 'owner');
      await seedUser('some-other-user', 'other');
      jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'original-owner' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'some-other-user', name: 'Renamed' }));
      const job = jobStorage.getJob('j1');
      expect(job.userId).toBe('original-owner');
      expect(job.name).toBe('Renamed');
    });

    it('keeps the stored dealType when update omits it', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'buy' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j1' })); // dealType defaults to null on update path
      expect(jobStorage.getJob('j1').dealType).toBe('buy');
    });

    it('overrides dealType when explicitly provided on update', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'rent' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'buy' }));
      expect(jobStorage.getJob('j1').dealType).toBe('buy');
    });

    it('updates all mutable fields', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', name: 'Before', enabled: true }));
      jobStorage.upsertJob(
        makeJob({
          jobId: 'j1',
          name: 'After',
          enabled: false,
          blacklist: ['x'],
          provider: [{ url: 'https://new.de' }],
          shareWithUsers: ['u5'],
          spatialFilter: { type: 'Point' },
          specFilter: { minRooms: 3 },
          commuteFilter: { action: 'hide' },
        }),
      );
      const job = jobStorage.getJob('j1');
      expect(job.name).toBe('After');
      expect(job.enabled).toBe(false);
      expect(job.blacklist).toEqual(['x']);
      expect(job.provider).toEqual([{ url: 'https://new.de' }]);
      expect(job.shared_with_user).toEqual(['u5']);
      expect(job.spatialFilter).toEqual({ type: 'Point' });
      expect(job.specFilter).toEqual({ minRooms: 3 });
      expect(job.commuteFilter).toEqual({ action: 'hide' });
    });
  });

  describe('getJob', () => {
    it('returns null for a non-existent job', () => {
      expect(jobStorage.getJob('ghost')).toBeNull();
    });

    it('counts active non-deleted listings as numberOfFoundListings', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      seedListings('j1', 'immoscout', ['h1', 'h2', 'h3']);
      const job = jobStorage.getJob('j1');
      expect(job.numberOfFoundListings).toBe(3);
    });

    it('returns 0 numberOfFoundListings for a job with no listings', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      expect(jobStorage.getJob('j1').numberOfFoundListings).toBe(0);
    });

    it('coerces enabled to boolean', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true }));
      jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false }));
      expect(jobStorage.getJob('j-on').enabled).toBe(true);
      expect(jobStorage.getJob('j-off').enabled).toBe(false);
    });
  });

  describe('getJobs', () => {
    it('excludes disabled jobs by default', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true, name: 'On' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false, name: 'Off' }));
      const jobs = jobStorage.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('On');
    });

    it('includes disabled jobs with includeDisabled: true', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true }));
      jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false }));
      expect(jobStorage.getJobs({ includeDisabled: true })).toHaveLength(2);
    });

    it('orders by name with NULLs last', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j3', name: 'Zebra' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j1', name: 'Alpha' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j2', name: null }));
      const names = jobStorage.getJobs({ includeDisabled: true }).map((j) => j.name);
      expect(names).toEqual(['Alpha', 'Zebra', null]);
    });

    it('coerces enabled to boolean for all returned jobs', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: true }));
      jobStorage.upsertJob(makeJob({ jobId: 'j2', enabled: false }));
      const jobs = jobStorage.getJobs({ includeDisabled: true });
      expect(jobs.every((j) => typeof j.enabled === 'boolean')).toBe(true);
    });

    it('hydrates notificationAdapter from configured_adapter channels', () => {
      const chId = seedChannel({ name: 'TG Chat', fields: { token: 'x', chatId: '1' } });
      jobStorage.upsertJob(makeJob({ jobId: 'j1', notificationAdapter: [{ configuredAdapterId: chId }] }));
      const job = jobStorage.getJobs({ includeDisabled: true })[0];
      expect(job.notificationAdapter).toHaveLength(1);
      expect(job.notificationAdapter[0]).toEqual({
        id: 'telegram',
        name: 'TG Chat',
        fields: { token: 'x', chatId: '1' },
        configuredAdapterId: chId,
      });
    });

    it('drops references to deleted channels instead of leaving holes', () => {
      const chId = seedChannel();
      jobStorage.upsertJob(makeJob({ jobId: 'j1', notificationAdapter: [{ configuredAdapterId: chId }] }));
      channelStorage.removeChannel(chId);
      expect(jobStorage.getJobs({ includeDisabled: true })[0].notificationAdapter).toEqual([]);
    });
  });

  describe('updateJobLastRunAt', () => {
    it('stores and returns the timestamp via getJob', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      const ts = Date.now();
      jobStorage.updateJobLastRunAt('j1', ts);
      expect(jobStorage.getJob('j1').lastRunAt).toBe(ts);
    });

    it('initially has null lastRunAt', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      expect(jobStorage.getJob('j1').lastRunAt).toBeNull();
    });
  });

  describe('setJobStatus', () => {
    it('disables an enabled job', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: true }));
      jobStorage.setJobStatus({ jobId: 'j1', status: false });
      expect(jobStorage.getJob('j1').enabled).toBe(false);
    });

    it('enables a disabled job', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: false }));
      jobStorage.setJobStatus({ jobId: 'j1', status: true });
      expect(jobStorage.getJob('j1').enabled).toBe(true);
    });
  });

  describe('removeJob', () => {
    it('deletes the job so getJob returns null', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      jobStorage.removeJob('j1');
      expect(jobStorage.getJob('j1')).toBeNull();
    });

    it('cascades deletion to listings', () => {
      jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      seedListings('j1', 'immoscout', ['h1', 'h2']);
      // Confirm listings exist before delete
      expect(listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout')).toHaveLength(2);
      jobStorage.removeJob('j1');
      expect(listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout')).toHaveLength(0);
    });

    it('is a no-op for a non-existent job', () => {
      expect(() => jobStorage.removeJob('ghost')).not.toThrow();
    });
  });

  describe('removeJobsByUserId', () => {
    it('removes all jobs belonging to the user', async () => {
      await seedUser('u1', 'alice');
      await seedUser('u2', 'bob');
      jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1' }));
      jobStorage.upsertJob(makeJob({ jobId: 'j3', userId: 'u2' }));
      jobStorage.removeJobsByUserId('u1');
      expect(jobStorage.getJob('j1')).toBeNull();
      expect(jobStorage.getJob('j2')).toBeNull();
      expect(jobStorage.getJob('j3')).not.toBeNull();
    });

    it('is a no-op for a user with no jobs', () => {
      expect(() => jobStorage.removeJobsByUserId('nobody')).not.toThrow();
    });
  });

  describe('queryJobs', () => {
    describe('access control', () => {
      it('returns only jobs owned by the user (non-admin)', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        jobStorage.upsertJob(makeJob({ jobId: 'j-alice', userId: 'u1', name: 'Alice Job' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j-bob', userId: 'u2', name: 'Bob Job' }));
        const { result, totalNumber } = jobStorage.queryJobs({ userId: 'u1' });
        expect(totalNumber).toBe(1);
        expect(result[0].name).toBe('Alice Job');
      });

      it('includes jobs shared with the user via shared_with_user', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        jobStorage.upsertJob(makeJob({ jobId: 'j-bob', userId: 'u2', name: 'Shared', shareWithUsers: ['u1'] }));
        const { result } = jobStorage.queryJobs({ userId: 'u1' });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Shared');
      });

      it('admin sees all jobs regardless of ownership', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u2' }));
        const { totalNumber } = jobStorage.queryJobs({ isAdmin: true });
        expect(totalNumber).toBe(2);
      });
    });

    describe('pagination', () => {
      it('respects pageSize and page', async () => {
        await seedUser('u1', 'alice');
        for (let i = 0; i < 5; i++) {
          jobStorage.upsertJob(makeJob({ jobId: `j${i}`, userId: 'u1', name: `Job ${String(i).padStart(2, '0')}` }));
        }
        const page1 = jobStorage.queryJobs({ userId: 'u1', pageSize: 2, page: 1 });
        expect(page1.result).toHaveLength(2);
        expect(page1.totalNumber).toBe(5);
        expect(page1.page).toBe(1);

        const page3 = jobStorage.queryJobs({ userId: 'u1', pageSize: 2, page: 3 });
        expect(page3.result).toHaveLength(1); // last page with 1 remaining
      });

      it('defaults to page 1 and pageSize 50', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1' }));
        const { page } = jobStorage.queryJobs({ userId: 'u1' });
        expect(page).toBe(1);
      });
    });

    describe('filtering', () => {
      it('filters by freeTextFilter on job name', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Berlin Apartments' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Munich Flats' }));
        const { result } = jobStorage.queryJobs({ userId: 'u1', freeTextFilter: 'Berlin' });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Berlin Apartments');
      });

      it('filters by activityFilter=true (enabled only)', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', enabled: true, name: 'Active' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', enabled: false, name: 'Paused' }));
        const { result } = jobStorage.queryJobs({ userId: 'u1', activityFilter: true });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Active');
      });

      it('filters by activityFilter=false (disabled only)', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', enabled: true }));
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', enabled: false, name: 'Off' }));
        const { result } = jobStorage.queryJobs({ userId: 'u1', activityFilter: false });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Off');
      });
    });

    describe('sorting', () => {
      it('sorts by name ascending by default', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Zebra' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Alpha' }));
        const { result } = jobStorage.queryJobs({ userId: 'u1' });
        expect(result.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
      });

      it('sorts by name descending', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Alpha' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Zebra' }));
        const { result } = jobStorage.queryJobs({ userId: 'u1', sortField: 'name', sortDir: 'desc' });
        expect(result.map((r) => r.name)).toEqual(['Zebra', 'Alpha']);
      });

      it('sorts by numberOfFoundListings', async () => {
        await seedUser('u1', 'alice');
        jobStorage.upsertJob(makeJob({ jobId: 'j-few', userId: 'u1', name: 'Few' }));
        jobStorage.upsertJob(makeJob({ jobId: 'j-many', userId: 'u1', name: 'Many' }));
        seedListings('j-many', 'immo', ['a', 'b', 'c']);
        seedListings('j-few', 'immo', ['x']);
        const { result } = jobStorage.queryJobs({
          userId: 'u1',
          sortField: 'numberOfFoundListings',
          sortDir: 'desc',
        });
        expect(result[0].name).toBe('Many');
        expect(result[1].name).toBe('Few');
      });
    });

    describe('hydration', () => {
      it('hydrates notificationAdapter fields from channels', async () => {
        await seedUser('u1', 'alice');
        const chId = seedChannel({ name: 'Discord', adapterId: 'discord', fields: { webhook: 'https://...' } });
        jobStorage.upsertJob(
          makeJob({ jobId: 'j1', userId: 'u1', notificationAdapter: [{ configuredAdapterId: chId }] }),
        );
        const { result } = jobStorage.queryJobs({ userId: 'u1' });
        expect(result[0].notificationAdapter).toHaveLength(1);
        expect(result[0].notificationAdapter[0].id).toBe('discord');
        expect(result[0].notificationAdapter[0].fields).toEqual({ webhook: 'https://...' });
      });
    });
  });
});
