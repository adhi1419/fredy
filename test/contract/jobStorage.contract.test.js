/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: jobStorage
 *
 * Firestore behavioral contract for the jobs module. Seeds and asserts ONLY
 * through the public storage API loaded by the Firestore contract harness.
 * Every storage call is awaited because Firestore is async.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let jobStorage;
let channelStorage;
let userStorage;
let listingsStorage;

beforeAll(async () => {
  await initBackend();
  jobStorage = await loadStorageModule('jobStorage');
  channelStorage = await loadStorageModule('configuredAdapterStorage');
  userStorage = await loadStorageModule('userStorage');
  listingsStorage = await loadStorageModule('listingsStorage');
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
  await userStorage.upsertUser({ userId: id, username, password: 'test123', isAdmin });

const makeJob = (overrides = {}) => ({
  userId: 'u1',
  name: 'Test Job',
  provider: [{ url: 'https://immoscout.de/mieten' }],
  notificationAdapter: [],
  enabled: true,
  ...overrides,
});

const seedChannel = async (overrides = {}) =>
  await channelStorage.upsertChannel({
    userId: 'u1',
    adapterId: 'telegram',
    name: 'Channel',
    fields: { token: 'tok', chatId: '123' },
    ...overrides,
  });

const seedListings = async (jobId, providerId, hashes) =>
  await listingsStorage.storeListings(
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
    it('creates a job retrievable by getJob', async () => {
      await jobStorage.upsertJob(makeJob({ name: 'New Job' }));
      const jobs = await jobStorage.getJobs({ includeDisabled: true });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('New Job');
    });

    it('generates an id when jobId is not provided', async () => {
      await jobStorage.upsertJob(makeJob());
      const jobs = await jobStorage.getJobs({ includeDisabled: true });
      expect(typeof jobs[0].id).toBe('string');
      expect(jobs[0].id.length).toBeGreaterThan(0);
    });

    it('uses the provided jobId when given', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'my-custom-id' }));
      const job = await jobStorage.getJob('my-custom-id');
      expect(job).not.toBeNull();
      expect(job.id).toBe('my-custom-id');
    });

    it('defaults dealType to rent when omitted', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-rent' }));
      expect((await jobStorage.getJob('j-rent')).dealType).toBe('rent');
    });

    it('persists an explicit buy dealType', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-buy', dealType: 'buy' }));
      expect((await jobStorage.getJob('j-buy')).dealType).toBe('buy');
    });

    it('defaults automatic inquiry sending to off', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-auto-default' }));
      expect((await jobStorage.getJob('j-auto-default')).autoSendInquiry).toBe(false);
    });

    it('persists explicit automatic inquiry sending', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-auto', autoSendInquiry: true }));
      expect((await jobStorage.getJob('j-auto')).autoSendInquiry).toBe(true);
    });

    it('adds a disabled source policy when no policy or legacy flag is provided', async () => {
      await jobStorage.upsertJob(
        makeJob({ jobId: 'j-policy-default', provider: [{ id: 'immoscout', url: 'https://immoscout.de/mieten' }] }),
      );
      expect((await jobStorage.getJob('j-policy-default')).provider).toEqual([
        {
          id: 'immoscout',
          url: 'https://immoscout.de/mieten',
          applicationPolicy: { automatic: 'disabled' },
        },
      ]);
    });

    it('accepts an enabled policy for a provider with automatic capability', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-enabled',
          provider: [
            {
              id: 'immoscout',
              url: 'https://immoscout.de/mieten',
              enabled: true,
              applicationPolicy: { automatic: 'enabled' },
            },
          ],
        }),
      );
      expect((await jobStorage.getJob('j-policy-enabled')).provider[0].applicationPolicy).toEqual({
        automatic: 'enabled',
      });
    });

    it('stores only canonical provider-source fields and never credentials or connections', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-sensitive-fields',
          provider: [
            {
              id: 'immoscout',
              name: 'ImmoScout24',
              url: 'https://immoscout.de/mieten',
              enabled: true,
              applicationPolicy: { automatic: 'enabled', token: 'nested-secret' },
              credentials: { password: 'must-not-persist' },
              connection: { accessToken: 'must-not-persist' },
            },
          ],
        }),
      );

      expect((await jobStorage.getJob('j-policy-sensitive-fields')).provider).toEqual([
        {
          id: 'immoscout',
          name: 'ImmoScout24',
          url: 'https://immoscout.de/mieten',
          enabled: true,
          applicationPolicy: { automatic: 'enabled' },
        },
      ]);
    });

    it('accepts enabled policy for listing-scoped capability and leaves listing checks to lifecycle', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-listing',
          provider: [
            {
              id: 'inberlinwohnen',
              url: 'https://inberlinwohnen.de/angebote',
              applicationPolicy: { automatic: 'enabled' },
            },
          ],
        }),
      );
      expect((await jobStorage.getJob('j-policy-listing')).provider[0].applicationPolicy).toEqual({
        automatic: 'enabled',
      });
    });

    it('rejects an explicit enabled policy for an unsupported capability', async () => {
      await expect(
        jobStorage.upsertJob(
          makeJob({
            jobId: 'j-policy-unsupported',
            provider: [
              { id: 'immowelt', url: 'https://www.immowelt.de/suche', applicationPolicy: { automatic: 'enabled' } },
            ],
          }),
        ),
      ).rejects.toThrow('not supported');
      expect(await jobStorage.getJob('j-policy-unsupported')).toBeNull();
    });

    it('uses persisted source policy before the legacy job flag on reads', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-precedence',
          autoSendInquiry: null,
          provider: [
            { id: 'immoscout', url: 'https://immoscout.de/mieten', applicationPolicy: { automatic: 'disabled' } },
          ],
        }),
      );
      expect((await jobStorage.getJob('j-policy-precedence')).provider[0].applicationPolicy).toEqual({
        automatic: 'disabled',
      });
    });

    it('lets an explicit legacy flag override source state during the compatibility window', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-legacy-override',
          autoSendInquiry: true,
          provider: [
            { id: 'immoscout', url: 'https://immoscout.de/mieten', applicationPolicy: { automatic: 'disabled' } },
          ],
        }),
      );
      expect((await jobStorage.getJob('j-policy-legacy-override')).provider[0].applicationPolicy).toEqual({
        automatic: 'enabled',
      });
    });

    it('uses the legacy flag when source policy is omitted', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-legacy-fallback',
          autoSendInquiry: true,
          provider: [{ id: 'immoscout', url: 'https://immoscout.de/mieten' }],
        }),
      );
      expect((await jobStorage.getJob('j-policy-legacy-fallback')).provider[0].applicationPolicy).toEqual({
        automatic: 'enabled',
      });
    });

    it('reads a legacy row without source policy without rewriting it', async () => {
      const { default: FirestoreConnection } =
        await import('../../lib/services/storage/firestore/FirestoreConnection.js');
      await FirestoreConnection.collection('jobs')
        .doc('j-legacy-row')
        .set({
          userId: 'u1',
          name: 'Legacy',
          provider: [{ id: 'immoscout', url: 'https://immoscout.de/mieten', enabled: true }],
          notificationAdapter: [],
          enabled: true,
          autoSendInquiry: true,
          dealType: 'rent',
          lastRunAt: null,
        });

      const job = await jobStorage.getJob('j-legacy-row');
      expect(job.provider[0].applicationPolicy).toEqual({ automatic: 'enabled' });
      expect((await FirestoreConnection.collection('jobs').doc('j-legacy-row').get()).data().provider[0]).toEqual({
        id: 'immoscout',
        url: 'https://immoscout.de/mieten',
        enabled: true,
      });
    });

    it('round-trips source policy updates without changing URL or enabled shape', async () => {
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-policy-roundtrip',
          provider: [
            {
              id: 'immoscout',
              url: 'https://immoscout.de/mieten',
              enabled: true,
              applicationPolicy: { automatic: 'enabled' },
            },
          ],
        }),
      );
      const existing = await jobStorage.getJob('j-policy-roundtrip');
      await jobStorage.upsertJob({ ...makeJob({ jobId: 'j-policy-roundtrip' }), provider: existing.provider });
      expect((await jobStorage.getJob('j-policy-roundtrip')).provider).toEqual(existing.provider);
    });

    it('round-trips all fields: blacklist, provider, spatialFilter, specFilter, commuteFilter, shareWithUsers', async () => {
      // A real GeoJSON polygon: coordinates are [[[lng,lat], ...]] — nested
      // arrays, which Firestore cannot store natively. This is exactly the
      // shape a drawn map bound produces and must round-trip through Firestore.
      const spatialFilter = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [13.404, 52.52],
                  [13.41, 52.52],
                  [13.41, 52.53],
                  [13.404, 52.53],
                  [13.404, 52.52],
                ],
              ],
            },
          },
        ],
      };
      const specFilter = { maxPrice: 1200, minSize: 50 };
      const commuteFilter = { action: 'notify', limits: { Work: 35 } };
      await jobStorage.upsertJob(
        makeJob({
          jobId: 'j-full',
          blacklist: ['bad-word'],
          shareWithUsers: ['u2', 'u3'],
          spatialFilter,
          specFilter,
          commuteFilter,
        }),
      );
      const job = await jobStorage.getJob('j-full');
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
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'original-owner' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'some-other-user', name: 'Renamed' }));
      const job = await jobStorage.getJob('j1');
      expect(job.userId).toBe('original-owner');
      expect(job.name).toBe('Renamed');
    });

    it('keeps the stored dealType when update omits it', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'buy' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' })); // dealType defaults to null on update path
      expect((await jobStorage.getJob('j1')).dealType).toBe('buy');
    });

    it('overrides dealType when explicitly provided on update', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'rent' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', dealType: 'buy' }));
      expect((await jobStorage.getJob('j1')).dealType).toBe('buy');
    });

    it('preserves auto-send when an update omits it and applies an explicit false', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', autoSendInquiry: true }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      expect((await jobStorage.getJob('j1')).autoSendInquiry).toBe(true);
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', autoSendInquiry: false }));
      expect((await jobStorage.getJob('j1')).autoSendInquiry).toBe(false);
    });

    it('updates all mutable fields', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', name: 'Before', enabled: true }));
      await jobStorage.upsertJob(
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
      const job = await jobStorage.getJob('j1');
      expect(job.name).toBe('After');
      expect(job.enabled).toBe(false);
      expect(job.blacklist).toEqual(['x']);
      expect(job.provider).toEqual([{ url: 'https://new.de', applicationPolicy: { automatic: 'disabled' } }]);
      expect(job.shared_with_user).toEqual(['u5']);
      expect(job.spatialFilter).toEqual({ type: 'Point' });
      expect(job.specFilter).toEqual({ minRooms: 3 });
      expect(job.commuteFilter).toEqual({ action: 'hide' });
    });
  });

  describe('getJob', () => {
    it('returns null for a non-existent job', async () => {
      expect(await jobStorage.getJob('ghost')).toBeNull();
    });

    it('counts active non-deleted listings as numberOfFoundListings', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      await seedListings('j1', 'immoscout', ['h1', 'h2', 'h3']);
      const job = await jobStorage.getJob('j1');
      expect(job.numberOfFoundListings).toBe(3);
    });

    it('returns 0 numberOfFoundListings for a job with no listings', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      expect((await jobStorage.getJob('j1')).numberOfFoundListings).toBe(0);
    });

    it('coerces enabled to boolean', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false }));
      expect((await jobStorage.getJob('j-on')).enabled).toBe(true);
      expect((await jobStorage.getJob('j-off')).enabled).toBe(false);
    });
  });

  describe('getJobs', () => {
    it('excludes disabled jobs by default', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true, name: 'On' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false, name: 'Off' }));
      const jobs = await jobStorage.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('On');
    });

    it('includes disabled jobs with includeDisabled: true', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j-on', enabled: true }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j-off', enabled: false }));
      expect(await jobStorage.getJobs({ includeDisabled: true })).toHaveLength(2);
    });

    it('orders by name with NULLs last', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j3', name: 'Zebra' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', name: 'Alpha' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j2', name: null }));
      const names = (await jobStorage.getJobs({ includeDisabled: true })).map((j) => j.name);
      expect(names).toEqual(['Alpha', 'Zebra', null]);
    });

    it('coerces enabled to boolean for all returned jobs', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: true }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j2', enabled: false }));
      const jobs = await jobStorage.getJobs({ includeDisabled: true });
      expect(jobs.every((j) => typeof j.enabled === 'boolean')).toBe(true);
    });

    it('hydrates notificationAdapter from configured_adapter channels', async () => {
      const chId = await seedChannel({ name: 'TG Chat', fields: { token: 'x', chatId: '1' } });
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', notificationAdapter: [{ configuredAdapterId: chId }] }));
      const job = (await jobStorage.getJobs({ includeDisabled: true }))[0];
      expect(job.notificationAdapter).toHaveLength(1);
      expect(job.notificationAdapter[0]).toEqual({
        id: 'telegram',
        name: 'TG Chat',
        fields: { token: 'x', chatId: '1' },
        configuredAdapterId: chId,
      });
    });

    it('drops references to deleted channels instead of leaving holes', async () => {
      const chId = await seedChannel();
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', notificationAdapter: [{ configuredAdapterId: chId }] }));
      await channelStorage.removeChannel(chId);
      expect((await jobStorage.getJobs({ includeDisabled: true }))[0].notificationAdapter).toEqual([]);
    });
  });

  describe('updateJobLastRunAt', () => {
    it('stores and returns the timestamp via getJob', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      const ts = Date.now();
      await jobStorage.updateJobLastRunAt('j1', ts);
      expect((await jobStorage.getJob('j1')).lastRunAt).toBe(ts);
    });

    it('initially has null lastRunAt', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      expect((await jobStorage.getJob('j1')).lastRunAt).toBeNull();
    });
  });

  describe('setJobStatus', () => {
    it('disables an enabled job', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: true }));
      await jobStorage.setJobStatus({ jobId: 'j1', status: false });
      expect((await jobStorage.getJob('j1')).enabled).toBe(false);
    });

    it('enables a disabled job', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', enabled: false }));
      await jobStorage.setJobStatus({ jobId: 'j1', status: true });
      expect((await jobStorage.getJob('j1')).enabled).toBe(true);
    });
  });

  describe('removeJob', () => {
    it('deletes the job so getJob returns null', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      await jobStorage.removeJob('j1');
      expect(await jobStorage.getJob('j1')).toBeNull();
    });

    it('cascades deletion to listings, watches, and listing subcollections', async () => {
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      const items = [
        {
          id: 'h1',
          price: 800,
          size: 60,
          rooms: 2,
          title: 'Listing h1',
          image: null,
          description: 'desc',
          address: 'Berlin',
          link: 'https://example.com/h1',
        },
        {
          id: 'h2',
          price: 900,
          size: 65,
          rooms: 2,
          title: 'Listing h2',
          image: null,
          description: 'desc',
          address: 'Berlin',
          link: 'https://example.com/h2',
        },
      ];
      await listingsStorage.storeListings('j1', 'immoscout', items);
      const watchListStorage = await loadStorageModule('watchListStorage');
      await watchListStorage.createWatch(items[0].id, 'u1');
      await listingsStorage.saveListingTravelTimes(
        items[0].id,
        [{ label: 'Home', transitMinutes: 20, isEstimate: true, referenceTime: 1000 }],
        1000,
      );
      await listingsStorage.recordPriceObservation(items[0].id, 800, 1000, 'contract');

      expect(await listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout')).toHaveLength(2);
      await jobStorage.removeJob('j1');

      expect(await listingsStorage.getKnownListingHashesForJobAndProvider('j1', 'immoscout')).toHaveLength(0);
      expect((await listingsStorage.getTravelTimesForListings([items[0].id])).size).toBe(0);
      expect(await listingsStorage.getPriceHistory(items[0].id)).toEqual([]);

      // Recreate the deterministic listing id and verify its old watch row did not survive.
      await jobStorage.upsertJob(makeJob({ jobId: 'j1' }));
      const recreated = [structuredClone(items[0])];
      await listingsStorage.storeListings('j1', 'immoscout', recreated);
      const queried = await listingsStorage.queryListings({ userId: 'u1' });
      expect(queried.result).toHaveLength(1);
      expect(queried.result[0].isWatched).toBe(0);
    });

    it('is a no-op for a non-existent job', async () => {
      // removeJob may return undefined (sync) or a Promise; either way it must not throw.
      await jobStorage.removeJob('ghost');
    });
  });

  describe('removeJobsByUserId', () => {
    it('removes all jobs belonging to the user', async () => {
      await seedUser('u1', 'alice');
      await seedUser('u2', 'bob');
      await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1' }));
      await jobStorage.upsertJob(makeJob({ jobId: 'j3', userId: 'u2' }));
      await jobStorage.removeJobsByUserId('u1');
      expect(await jobStorage.getJob('j1')).toBeNull();
      expect(await jobStorage.getJob('j2')).toBeNull();
      expect(await jobStorage.getJob('j3')).not.toBeNull();
    });

    it('is a no-op for a user with no jobs', async () => {
      await jobStorage.removeJobsByUserId('nobody');
    });
  });

  describe('queryJobs', () => {
    describe('access control', () => {
      it('returns only jobs owned by the user (non-admin)', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        await jobStorage.upsertJob(makeJob({ jobId: 'j-alice', userId: 'u1', name: 'Alice Job' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j-bob', userId: 'u2', name: 'Bob Job' }));
        const { result, totalNumber } = await jobStorage.queryJobs({ userId: 'u1' });
        expect(totalNumber).toBe(1);
        expect(result[0].name).toBe('Alice Job');
      });

      it('includes jobs shared with the user via shared_with_user', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        await jobStorage.upsertJob(makeJob({ jobId: 'j-bob', userId: 'u2', name: 'Shared', shareWithUsers: ['u1'] }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1' });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Shared');
      });

      it('scopes admins to their own and explicitly shared jobs', async () => {
        await seedUser('u1', 'alice');
        await seedUser('u2', 'bob');
        await seedUser('admin', 'admin', true);
        await jobStorage.upsertJob(makeJob({ jobId: 'j-admin', userId: 'admin', name: 'Admin Job' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j-private', userId: 'u1', name: 'Private Job' }));
        await jobStorage.upsertJob(
          makeJob({ jobId: 'j-shared-admin', userId: 'u2', name: 'Shared Admin Job', shareWithUsers: ['admin'] }),
        );

        const { result } = await jobStorage.queryJobs({ userId: 'admin', isAdmin: true });
        expect(result.map((job) => job.name).sort()).toEqual(['Admin Job', 'Shared Admin Job']);
      });
    });

    describe('pagination', () => {
      it('respects pageSize and page', async () => {
        await seedUser('u1', 'alice');
        for (let i = 0; i < 5; i++) {
          await jobStorage.upsertJob(
            makeJob({ jobId: `j${i}`, userId: 'u1', name: `Job ${String(i).padStart(2, '0')}` }),
          );
        }
        const page1 = await jobStorage.queryJobs({ userId: 'u1', pageSize: 2, page: 1 });
        expect(page1.result).toHaveLength(2);
        expect(page1.totalNumber).toBe(5);
        expect(page1.page).toBe(1);

        const page3 = await jobStorage.queryJobs({ userId: 'u1', pageSize: 2, page: 3 });
        expect(page3.result).toHaveLength(1); // last page with 1 remaining
      });

      it('defaults to page 1 and pageSize 50', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1' }));
        const { page } = await jobStorage.queryJobs({ userId: 'u1' });
        expect(page).toBe(1);
      });

      it.each([
        { input: { page: 0, pageSize: 0 }, expectedPage: 1, expectedLength: 5 },
        { input: { page: -2, pageSize: 2 }, expectedPage: 1, expectedLength: 2 },
        { input: { page: 1, pageSize: 1001 }, expectedPage: 1, expectedLength: 5 },
      ])('normalizes pagination input %#', async ({ input, expectedPage, expectedLength }) => {
        for (let i = 0; i < 5; i++) {
          await jobStorage.upsertJob(
            makeJob({ jobId: `pagination-boundary-${i}`, userId: 'u1', name: `Job ${String(i).padStart(2, '0')}` }),
          );
        }

        const result = await jobStorage.queryJobs({ ...input, userId: 'u1' });

        expect(result.page).toBe(expectedPage);
        expect(result.result).toHaveLength(expectedLength);
        expect(result.totalNumber).toBe(5);
      });
    });

    describe('filtering', () => {
      it('filters by freeTextFilter on job name', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Berlin Apartments' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Munich Flats' }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1', freeTextFilter: 'Berlin' });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Berlin Apartments');
      });

      it('filters by activityFilter=true (enabled only)', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', enabled: true, name: 'Active' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', enabled: false, name: 'Paused' }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1', activityFilter: true });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Active');
      });

      it('filters by activityFilter=false (disabled only)', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', enabled: true }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', enabled: false, name: 'Off' }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1', activityFilter: false });
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Off');
      });
    });

    describe('sorting', () => {
      it('sorts by name ascending by default', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Zebra' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Alpha' }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1' });
        expect(result.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
      });

      it('sorts by name descending', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j1', userId: 'u1', name: 'Alpha' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j2', userId: 'u1', name: 'Zebra' }));
        const { result } = await jobStorage.queryJobs({ userId: 'u1', sortField: 'name', sortDir: 'desc' });
        expect(result.map((r) => r.name)).toEqual(['Zebra', 'Alpha']);
      });

      it('sorts by numberOfFoundListings', async () => {
        await seedUser('u1', 'alice');
        await jobStorage.upsertJob(makeJob({ jobId: 'j-few', userId: 'u1', name: 'Few' }));
        await jobStorage.upsertJob(makeJob({ jobId: 'j-many', userId: 'u1', name: 'Many' }));
        await seedListings('j-many', 'immo', ['a', 'b', 'c']);
        await seedListings('j-few', 'immo', ['x']);
        const { result } = await jobStorage.queryJobs({
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
        const chId = await seedChannel({ name: 'Discord', adapterId: 'discord', fields: { webhook: 'https://...' } });
        await jobStorage.upsertJob(
          makeJob({ jobId: 'j1', userId: 'u1', notificationAdapter: [{ configuredAdapterId: chId }] }),
        );
        const { result } = await jobStorage.queryJobs({ userId: 'u1' });
        expect(result[0].notificationAdapter).toHaveLength(1);
        expect(result[0].notificationAdapter[0].id).toBe('discord');
        expect(result[0].notificationAdapter[0].fields).toEqual({ webhook: 'https://...' });
      });
    });
  });
});
