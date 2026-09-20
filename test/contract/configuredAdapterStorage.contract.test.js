/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: configuredAdapterStorage
 *
 * Firestore behavioral contract for configured adapter (channel) storage.
 * Seeds and asserts ONLY through the public storage API loaded by the Firestore
 * contract harness. Every storage call is awaited because Firestore is async.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let channelStorage;
let jobStorage;
let userStorage;

beforeAll(async () => {
  await initBackend();
  channelStorage = await loadStorageModule('configuredAdapterStorage');
  jobStorage = await loadStorageModule('jobStorage');
  userStorage = await loadStorageModule('userStorage');
});

beforeEach(async () => {
  await resetBackend();
  // Both configured_adapter and jobs have FK to users; seed a default user.
  await userStorage.upsertUser({ userId: 'user-1', username: 'testuser', password: 'test123', isAdmin: false });
});

afterAll(async () => {
  await teardownBackend();
});

const makeChannel = (overrides = {}) => ({
  userId: 'user-1',
  adapterId: 'telegram',
  name: 'Test Channel',
  fields: { token: 'tok-123', chatId: '456' },
  ...overrides,
});

describe('configuredAdapterStorage contract', () => {
  describe('upsertChannel', () => {
    it('inserts a new channel and returns its id', async () => {
      const id = await channelStorage.upsertChannel(makeChannel());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('round-trips all fields through insert + getChannel', async () => {
      const id = await channelStorage.upsertChannel(
        makeChannel({ name: 'My Telegram', fields: { token: 'abc', chatId: '789' }, visibility: 'admin' }),
      );
      const ch = await channelStorage.getChannel(id);
      expect(ch.userId).toBe('user-1');
      expect(ch.adapterId).toBe('telegram');
      expect(ch.name).toBe('My Telegram');
      expect(ch.fields).toEqual({ token: 'abc', chatId: '789' });
      expect(ch.visibility).toBe('admin');
      expect(typeof ch.createdAt).toBe('number');
      expect(typeof ch.updatedAt).toBe('number');
    });

    it('updates name, fields, and visibility on an existing channel', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ name: 'Original', visibility: 'private' }));
      await channelStorage.upsertChannel({
        id,
        userId: 'user-1',
        adapterId: 'telegram',
        name: 'Updated',
        fields: { token: 'new-tok' },
        visibility: 'everyone',
      });
      const ch = await channelStorage.getChannel(id);
      expect(ch.name).toBe('Updated');
      expect(ch.fields).toEqual({ token: 'new-tok' });
      expect(ch.visibility).toBe('everyone');
    });

    it('preserves userId and adapterId on update (immutable at creation)', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ userId: 'user-1', adapterId: 'telegram' }));
      // Attempt to change owner and adapter type via update:
      await channelStorage.upsertChannel({
        id,
        userId: 'user-999',
        adapterId: 'discord',
        name: 'Renamed',
        fields: {},
      });
      const ch = await channelStorage.getChannel(id);
      expect(ch.userId).toBe('user-1');
      expect(ch.adapterId).toBe('telegram');
    });

    it('sets updatedAt on update to a value >= createdAt', async () => {
      const id = await channelStorage.upsertChannel(makeChannel());
      const before = await channelStorage.getChannel(id);
      // Small delay to ensure timestamp can differ
      await channelStorage.upsertChannel({ id, userId: 'user-1', adapterId: 'telegram', name: 'Edited', fields: {} });
      const after = await channelStorage.getChannel(id);
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.createdAt);
    });
  });

  describe('getChannel', () => {
    it('returns null for a non-existent id', async () => {
      expect(await channelStorage.getChannel('does-not-exist')).toBeNull();
    });
  });

  describe('getAllChannels', () => {
    it('returns channels ordered by name', async () => {
      await channelStorage.upsertChannel(makeChannel({ name: 'Zebra' }));
      await channelStorage.upsertChannel(makeChannel({ name: 'Alpha' }));
      await channelStorage.upsertChannel(makeChannel({ name: 'Middle' }));
      const names = (await channelStorage.getAllChannels()).map((c) => c.name);
      expect(names).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('returns an empty array when no channels exist', async () => {
      expect(await channelStorage.getAllChannels()).toEqual([]);
    });
  });

  describe('getChannelsVisibleTo', () => {
    // A second tenant to prove isolation: user-2 owns channels user-1 must never see unless shared.
    const OWNER = { id: 'user-1', isAdmin: false };
    const STRANGER = { id: 'user-2', isAdmin: false };
    const ADMIN = { id: 'admin-1', isAdmin: true };

    const seedForOther = (visibility, name) =>
      channelStorage.upsertChannel(makeChannel({ userId: 'user-2', visibility, name }));

    it('returns an empty array for a null user', async () => {
      await channelStorage.upsertChannel(makeChannel({ visibility: 'everyone' }));
      expect(await channelStorage.getChannelsVisibleTo(null)).toEqual([]);
    });

    it('gives an owner their own private channel', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ userId: 'user-1', visibility: 'private' }));
      const visible = await channelStorage.getChannelsVisibleTo(OWNER);
      expect(visible.map((c) => c.id)).toEqual([id]);
    });

    it('hides another tenant private channel from a stranger', async () => {
      await seedForOther('private', 'Other Private');
      expect(await channelStorage.getChannelsVisibleTo(OWNER)).toEqual([]);
    });

    it('does not expose another tenant private channel to an admin (admin status is not visibility)', async () => {
      await seedForOther('private', 'Other Private');
      expect(await channelStorage.getChannelsVisibleTo(ADMIN)).toEqual([]);
    });

    it('shows an everyone channel to any tenant, including a stranger and an admin', async () => {
      const id = await seedForOther('everyone', 'Shared With All');
      expect((await channelStorage.getChannelsVisibleTo(OWNER)).map((c) => c.id)).toEqual([id]);
      expect((await channelStorage.getChannelsVisibleTo(ADMIN)).map((c) => c.id)).toEqual([id]);
    });

    it('shows an admin-visibility channel to an admin but not to an ordinary tenant', async () => {
      const id = await seedForOther('admin', 'Admin Only');
      expect(await channelStorage.getChannelsVisibleTo(OWNER)).toEqual([]);
      expect((await channelStorage.getChannelsVisibleTo(ADMIN)).map((c) => c.id)).toEqual([id]);
    });

    it('scopes a mixed set correctly per caller and preserves the name ordering of getAllChannels', async () => {
      // Names chosen so the underlying getAllChannels order (by name) is deterministic.
      const ownPrivate = await channelStorage.upsertChannel(
        makeChannel({ userId: 'user-1', visibility: 'private', name: 'A own private' }),
      );
      const everyone = await seedForOther('everyone', 'B everyone');
      const adminOnly = await seedForOther('admin', 'C admin');
      await seedForOther('private', 'D other private');

      const ownerView = (await channelStorage.getChannelsVisibleTo(OWNER)).map((c) => c.id);
      expect(ownerView).toEqual([ownPrivate, everyone]);

      const strangerView = (await channelStorage.getChannelsVisibleTo(STRANGER)).map((c) => c.name);
      // user-2 owns everything except ownPrivate: sees its own private + admin + everyone, ordered by name.
      expect(strangerView).toEqual(['B everyone', 'C admin', 'D other private']);

      const adminView = (await channelStorage.getChannelsVisibleTo(ADMIN)).map((c) => c.id);
      // Admin sees everyone + admin-visibility, but not either tenant's private channels.
      expect(adminView).toEqual([everyone, adminOnly]);
    });

    it('leaves getAllChannels unscoped so job hydration still sees every channel', async () => {
      await channelStorage.upsertChannel(makeChannel({ userId: 'user-1', visibility: 'private', name: 'One' }));
      await seedForOther('private', 'Two');
      expect((await channelStorage.getAllChannels()).length).toBe(2);
    });
  });

  describe('removeChannel', () => {
    it('deletes the channel so getChannel returns null', async () => {
      const id = await channelStorage.upsertChannel(makeChannel());
      expect(await channelStorage.getChannel(id)).not.toBeNull();
      await channelStorage.removeChannel(id);
      expect(await channelStorage.getChannel(id)).toBeNull();
    });

    it('is a no-op for a non-existent id', async () => {
      await channelStorage.removeChannel('nope');
    });
  });

  describe('VISIBILITY normalisation', () => {
    it('accepts the three known values: private, admin, everyone', async () => {
      for (const vis of ['private', 'admin', 'everyone']) {
        const id = await channelStorage.upsertChannel(makeChannel({ name: `vis-${vis}`, visibility: vis }));
        expect((await channelStorage.getChannel(id)).visibility).toBe(vis);
      }
    });

    it('normalises an unknown visibility to private', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ visibility: 'INVALID' }));
      expect((await channelStorage.getChannel(id)).visibility).toBe('private');
    });

    it('normalises undefined visibility to private', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ visibility: undefined }));
      expect((await channelStorage.getChannel(id)).visibility).toBe('private');
    });

    it('normalises null visibility to private', async () => {
      const id = await channelStorage.upsertChannel(makeChannel({ visibility: null }));
      expect((await channelStorage.getChannel(id)).visibility).toBe('private');
    });
  });

  describe('getJobsUsingChannel', () => {
    it('returns jobs that reference the channel in notification_adapter', async () => {
      const chId = await channelStorage.upsertChannel(makeChannel({ name: 'Used Channel' }));
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Job A',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Job B',
        provider: [],
        notificationAdapter: [],
      });
      const using = await channelStorage.getJobsUsingChannel(chId);
      expect(using).toHaveLength(1);
      expect(using[0].name).toBe('Job A');
    });

    it('returns multiple jobs ordered by name', async () => {
      const chId = await channelStorage.upsertChannel(makeChannel());
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Zeta Job',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Alpha Job',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      const names = (await channelStorage.getJobsUsingChannel(chId)).map((j) => j.name);
      expect(names).toEqual(['Alpha Job', 'Zeta Job']);
    });

    it('returns an empty array for an unreferenced channel', async () => {
      const chId = await channelStorage.upsertChannel(makeChannel());
      expect(await channelStorage.getJobsUsingChannel(chId)).toEqual([]);
    });

    it('returns an empty array for a non-existent channel id', async () => {
      expect(await channelStorage.getJobsUsingChannel('ghost')).toEqual([]);
    });
  });

  describe('getUsageCounts', () => {
    it('counts how many jobs reference each channel', async () => {
      const ch1 = await channelStorage.upsertChannel(makeChannel({ name: 'Ch1' }));
      const ch2 = await channelStorage.upsertChannel(makeChannel({ name: 'Ch2' }));
      // Job 1 uses ch1 only
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J1',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch1 }],
      });
      // Job 2 uses both
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J2',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch1 }, { configuredAdapterId: ch2 }],
      });
      const counts = await channelStorage.getUsageCounts();
      expect(counts.get(ch1)).toBe(2);
      expect(counts.get(ch2)).toBe(1);
    });

    it('returns an empty map when no jobs exist', async () => {
      await channelStorage.upsertChannel(makeChannel());
      const counts = await channelStorage.getUsageCounts();
      expect(counts.size).toBe(0);
    });

    it('does not count a channel with no references', async () => {
      const ch1 = await channelStorage.upsertChannel(makeChannel({ name: 'Unused' }));
      const ch2 = await channelStorage.upsertChannel(makeChannel({ name: 'Used' }));
      await jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J1',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch2 }],
      });
      const counts = await channelStorage.getUsageCounts();
      expect(counts.has(ch1)).toBe(false);
      expect(counts.get(ch2)).toBe(1);
    });
  });
});
