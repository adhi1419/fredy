/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: settingsStorage
 *
 * Backend-agnostic behavioral contract for the settings module. Seeds and
 * asserts ONLY through the public storage API (loaded via the harness so the
 * same suite runs against every backend). Every storage call is awaited:
 * the sqlite implementation is synchronous (await is a no-op), the firestore
 * one is async.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let settingsStorage;

beforeAll(async () => {
  await initBackend();
  settingsStorage = await loadStorageModule('settingsStorage');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

describe('settingsStorage contract', () => {
  describe('global settings', () => {
    it('returns config-file values when nothing is stored', async () => {
      const settings = await settingsStorage.getSettings();
      // Values injected by the contract setup config.
      expect(settings.interval).toBe(60);
      expect(settings.port).toBe(9998);
    });

    it('round-trips a stored value through upsert + get', async () => {
      await settingsStorage.upsertSettings({ workingHourFrom: '08:00' });
      const settings = await settingsStorage.getSettings();
      expect(settings.workingHourFrom).toBe('08:00');
    });

    it('stored settings override config-file values of the same name', async () => {
      await settingsStorage.upsertSettings({ interval: 5 });
      const settings = await settingsStorage.getSettings();
      expect(settings.interval).toBe(5);
    });

    it('updates an existing setting in place (upsert semantics)', async () => {
      await settingsStorage.upsertSettings({ proxyUrl: 'http://one' });
      await settingsStorage.upsertSettings({ proxyUrl: 'http://two' });
      const settings = await settingsStorage.getSettings();
      expect(settings.proxyUrl).toBe('http://two');
    });

    it('upserts multiple settings from one object map', async () => {
      await settingsStorage.upsertSettings({ a: 1, b: 'x', c: { nested: true } });
      const settings = await settingsStorage.getSettings();
      expect(settings.a).toBe(1);
      expect(settings.b).toBe('x');
      expect(settings.c).toEqual({ nested: true });
    });

    it('accepts the single {name, value} entry shape', async () => {
      await settingsStorage.upsertSettings({ name: 'demoMode', value: true });
      const settings = await settingsStorage.getSettings();
      expect(settings.demoMode).toBe(true);
    });

    it('preserves value types: numbers, booleans, arrays, objects, null-in-object', async () => {
      await settingsStorage.upsertSettings({
        num: 42.5,
        boolTrue: true,
        boolFalse: false,
        arr: [1, 'two', { three: 3 }],
        obj: { deep: { deeper: 'value' } },
      });
      const settings = await settingsStorage.getSettings();
      expect(settings.num).toBe(42.5);
      expect(settings.boolTrue).toBe(true);
      expect(settings.boolFalse).toBe(false);
      expect(settings.arr).toEqual([1, 'two', { three: 3 }]);
      expect(settings.obj).toEqual({ deep: { deeper: 'value' } });
    });

    it('deletes a setting when the value is null', async () => {
      await settingsStorage.upsertSettings({ toDelete: 'exists' });
      expect((await settingsStorage.getSettings()).toDelete).toBe('exists');
      await settingsStorage.upsertSettings({ toDelete: null });
      const settings = await settingsStorage.getSettings();
      expect(settings.toDelete).toBeUndefined();
    });

    it('cache invalidation: getSettings reflects writes made after a prior read', async () => {
      await settingsStorage.getSettings(); // populate cache
      await settingsStorage.upsertSettings({ addedLater: 'yes' });
      const settings = await settingsStorage.getSettings();
      expect(settings.addedLater).toBe('yes');
    });
  });

  describe('user settings', () => {
    it('stores user settings separately from global settings', async () => {
      await settingsStorage.upsertSettings({ language: 'global-en' });
      await settingsStorage.upsertSettings({ language: 'de' }, 'user-1');

      const globalSettings = await settingsStorage.getSettings();
      const userSettings = await settingsStorage.getUserSettings('user-1');

      expect(globalSettings.language).toBe('global-en');
      expect(userSettings.language).toBe('de');
    });

    it('isolates settings between users', async () => {
      await settingsStorage.upsertSettings({ theme: 'dark' }, 'user-1');
      await settingsStorage.upsertSettings({ theme: 'light' }, 'user-2');
      expect((await settingsStorage.getUserSettings('user-1')).theme).toBe('dark');
      expect((await settingsStorage.getUserSettings('user-2')).theme).toBe('light');
    });

    it('returns an empty object for a user with no settings', async () => {
      expect(await settingsStorage.getUserSettings('nobody')).toEqual({});
    });

    it('returns an empty object for missing/invalid userId', async () => {
      expect(await settingsStorage.getUserSettings(null)).toEqual({});
      expect(await settingsStorage.getUserSettings(undefined)).toEqual({});
      expect(await settingsStorage.getUserSettings(123)).toEqual({});
    });

    it('user settings do not leak into global settings', async () => {
      await settingsStorage.upsertSettings({ userOnly: 'private' }, 'user-1');
      const globalSettings = await settingsStorage.getSettings();
      expect(globalSettings.userOnly).toBeUndefined();
    });

    it('deletes a user setting when the value is null', async () => {
      await settingsStorage.upsertSettings({ gone: 'soon' }, 'user-1');
      expect((await settingsStorage.getUserSettings('user-1')).gone).toBe('soon');
      await settingsStorage.upsertSettings({ gone: null }, 'user-1');
      expect((await settingsStorage.getUserSettings('user-1')).gone).toBeUndefined();
    });
  });

  describe('getAddresses', () => {
    it('extracts home_addresses array from a settings object', () => {
      const addresses = [{ address: 'Somestr. 1, Berlin', lat: 52.5, lng: 13.4 }];
      expect(settingsStorage.getAddresses({ home_addresses: addresses })).toEqual(addresses);
    });

    it('returns [] when home_addresses is missing or not an array', () => {
      expect(settingsStorage.getAddresses({})).toEqual([]);
      expect(settingsStorage.getAddresses({ home_addresses: 'nope' })).toEqual([]);
      expect(settingsStorage.getAddresses(null)).toEqual([]);
    });
  });

  describe('getPublicSettings', () => {
    it('strips secrets (session_secret, proxyAuthSecret) but keeps admin config', async () => {
      await settingsStorage.upsertSettings({
        session_secret: 'top-secret',
        proxyAuthSecret: 'also-secret',
        proxyUrl: 'http://proxy:8080',
      });
      const publicSettings = await settingsStorage.getPublicSettings();
      expect(publicSettings.session_secret).toBeUndefined();
      expect(publicSettings.proxyAuthSecret).toBeUndefined();
      expect(publicSettings.proxyUrl).toBe('http://proxy:8080');
    });
  });

  describe('getOrCreateSessionSecret', () => {
    it('creates a secret on first call and returns the same one afterwards', async () => {
      const first = await settingsStorage.getOrCreateSessionSecret();
      expect(typeof first).toBe('string');
      expect(first.length).toBeGreaterThanOrEqual(32);
      const second = await settingsStorage.getOrCreateSessionSecret();
      expect(second).toBe(first);
    });
  });
});
