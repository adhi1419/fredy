/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: configuredAdapterStorage
 *
 * Backend-agnostic behavioral contract for configured adapter (channel) storage.
 * Seeds and asserts ONLY through the public storage API.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let channelStorage;
let jobStorage;
let userStorage;

beforeAll(async () => {
  await initBackend();
  channelStorage = await import('../../lib/services/storage/configuredAdapterStorage.js');
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
  userStorage = await import('../../lib/services/storage/userStorage.js');
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
    it('inserts a new channel and returns its id', () => {
      const id = channelStorage.upsertChannel(makeChannel());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('round-trips all fields through insert + getChannel', () => {
      const id = channelStorage.upsertChannel(
        makeChannel({ name: 'My Telegram', fields: { token: 'abc', chatId: '789' }, visibility: 'admin' }),
      );
      const ch = channelStorage.getChannel(id);
      expect(ch.userId).toBe('user-1');
      expect(ch.adapterId).toBe('telegram');
      expect(ch.name).toBe('My Telegram');
      expect(ch.fields).toEqual({ token: 'abc', chatId: '789' });
      expect(ch.visibility).toBe('admin');
      expect(typeof ch.createdAt).toBe('number');
      expect(typeof ch.updatedAt).toBe('number');
    });

    it('updates name, fields, and visibility on an existing channel', () => {
      const id = channelStorage.upsertChannel(makeChannel({ name: 'Original', visibility: 'private' }));
      channelStorage.upsertChannel({
        id,
        userId: 'user-1',
        adapterId: 'telegram',
        name: 'Updated',
        fields: { token: 'new-tok' },
        visibility: 'everyone',
      });
      const ch = channelStorage.getChannel(id);
      expect(ch.name).toBe('Updated');
      expect(ch.fields).toEqual({ token: 'new-tok' });
      expect(ch.visibility).toBe('everyone');
    });

    it('preserves userId and adapterId on update (immutable at creation)', () => {
      const id = channelStorage.upsertChannel(makeChannel({ userId: 'user-1', adapterId: 'telegram' }));
      // Attempt to change owner and adapter type via update:
      channelStorage.upsertChannel({
        id,
        userId: 'user-999',
        adapterId: 'discord',
        name: 'Renamed',
        fields: {},
      });
      const ch = channelStorage.getChannel(id);
      expect(ch.userId).toBe('user-1');
      expect(ch.adapterId).toBe('telegram');
    });

    it('sets updatedAt on update to a value >= createdAt', () => {
      const id = channelStorage.upsertChannel(makeChannel());
      const before = channelStorage.getChannel(id);
      // Small delay to ensure timestamp can differ
      channelStorage.upsertChannel({ id, userId: 'user-1', adapterId: 'telegram', name: 'Edited', fields: {} });
      const after = channelStorage.getChannel(id);
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.createdAt);
    });
  });

  describe('getChannel', () => {
    it('returns null for a non-existent id', () => {
      expect(channelStorage.getChannel('does-not-exist')).toBeNull();
    });
  });

  describe('getAllChannels', () => {
    it('returns channels ordered by name', () => {
      channelStorage.upsertChannel(makeChannel({ name: 'Zebra' }));
      channelStorage.upsertChannel(makeChannel({ name: 'Alpha' }));
      channelStorage.upsertChannel(makeChannel({ name: 'Middle' }));
      const names = channelStorage.getAllChannels().map((c) => c.name);
      expect(names).toEqual(['Alpha', 'Middle', 'Zebra']);
    });

    it('returns an empty array when no channels exist', () => {
      expect(channelStorage.getAllChannels()).toEqual([]);
    });
  });

  describe('removeChannel', () => {
    it('deletes the channel so getChannel returns null', () => {
      const id = channelStorage.upsertChannel(makeChannel());
      expect(channelStorage.getChannel(id)).not.toBeNull();
      channelStorage.removeChannel(id);
      expect(channelStorage.getChannel(id)).toBeNull();
    });

    it('is a no-op for a non-existent id', () => {
      expect(() => channelStorage.removeChannel('nope')).not.toThrow();
    });
  });

  describe('VISIBILITY normalisation', () => {
    it('accepts the three known values: private, admin, everyone', () => {
      for (const vis of ['private', 'admin', 'everyone']) {
        const id = channelStorage.upsertChannel(makeChannel({ name: `vis-${vis}`, visibility: vis }));
        expect(channelStorage.getChannel(id).visibility).toBe(vis);
      }
    });

    it('normalises an unknown visibility to private', () => {
      const id = channelStorage.upsertChannel(makeChannel({ visibility: 'INVALID' }));
      expect(channelStorage.getChannel(id).visibility).toBe('private');
    });

    it('normalises undefined visibility to private', () => {
      const id = channelStorage.upsertChannel(makeChannel({ visibility: undefined }));
      expect(channelStorage.getChannel(id).visibility).toBe('private');
    });

    it('normalises null visibility to private', () => {
      const id = channelStorage.upsertChannel(makeChannel({ visibility: null }));
      expect(channelStorage.getChannel(id).visibility).toBe('private');
    });
  });

  describe('getJobsUsingChannel', () => {
    it('returns jobs that reference the channel in notification_adapter', () => {
      const chId = channelStorage.upsertChannel(makeChannel({ name: 'Used Channel' }));
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Job A',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Job B',
        provider: [],
        notificationAdapter: [],
      });
      const using = channelStorage.getJobsUsingChannel(chId);
      expect(using).toHaveLength(1);
      expect(using[0].name).toBe('Job A');
    });

    it('returns multiple jobs ordered by name', () => {
      const chId = channelStorage.upsertChannel(makeChannel());
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Zeta Job',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'Alpha Job',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: chId }],
      });
      const names = channelStorage.getJobsUsingChannel(chId).map((j) => j.name);
      expect(names).toEqual(['Alpha Job', 'Zeta Job']);
    });

    it('returns an empty array for an unreferenced channel', () => {
      const chId = channelStorage.upsertChannel(makeChannel());
      expect(channelStorage.getJobsUsingChannel(chId)).toEqual([]);
    });

    it('returns an empty array for a non-existent channel id', () => {
      expect(channelStorage.getJobsUsingChannel('ghost')).toEqual([]);
    });
  });

  describe('getUsageCounts', () => {
    it('counts how many jobs reference each channel', () => {
      const ch1 = channelStorage.upsertChannel(makeChannel({ name: 'Ch1' }));
      const ch2 = channelStorage.upsertChannel(makeChannel({ name: 'Ch2' }));
      // Job 1 uses ch1 only
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J1',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch1 }],
      });
      // Job 2 uses both
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J2',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch1 }, { configuredAdapterId: ch2 }],
      });
      const counts = channelStorage.getUsageCounts();
      expect(counts.get(ch1)).toBe(2);
      expect(counts.get(ch2)).toBe(1);
    });

    it('returns an empty map when no jobs exist', () => {
      channelStorage.upsertChannel(makeChannel());
      const counts = channelStorage.getUsageCounts();
      expect(counts.size).toBe(0);
    });

    it('does not count a channel with no references', () => {
      const ch1 = channelStorage.upsertChannel(makeChannel({ name: 'Unused' }));
      const ch2 = channelStorage.upsertChannel(makeChannel({ name: 'Used' }));
      jobStorage.upsertJob({
        userId: 'user-1',
        name: 'J1',
        provider: [],
        notificationAdapter: [{ configuredAdapterId: ch2 }],
      });
      const counts = channelStorage.getUsageCounts();
      expect(counts.has(ch1)).toBe(false);
      expect(counts.get(ch2)).toBe(1);
    });
  });
});
