/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');
const modPath = root + '/lib/services/maintenance/maintenanceSweeps.js';

const HOUR = 60 * 60 * 1000;

describe('services/maintenance/maintenanceSweeps', () => {
  /** @type {Record<string, any>} */
  let stored;
  /** @type {string[]} */
  let calls;
  /** @type {Array<Record<string, any>>} */
  let upserts;
  let aliveImpl = async () => {};

  async function load() {
    vi.resetModules();
    calls = [];
    upserts = [];
    vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
      getSettings: async () => stored,
      upsertSettings: async (map) => {
        upserts.push(map);
        stored = { ...stored, ...map };
      },
    }));
    vi.doMock(root + '/lib/services/storage/listingsStorage.js', () => ({
      getListingsToGeocode: async () => {
        calls.push('geocode');
        return [];
      },
      updateListingGeocoordinates: async () => {},
    }));
    vi.doMock(root + '/lib/services/geocoding/geoCodingService.js', () => ({
      geocodeAddress: async () => null,
      isGeocodingPaused: () => false,
    }));
    vi.doMock(root + '/lib/services/providers/providerCountries.js', () => ({
      getCountriesForProvider: async () => ['de'],
    }));
    vi.doMock(root + '/lib/services/storage/jobStorage.js', () => ({ getJobs: async () => [] }));
    vi.doMock(root + '/lib/services/geocoding/distanceService.js', () => ({ calculateDistanceForJob: async () => {} }));
    vi.doMock(root + '/lib/services/listings/listingActiveService.js', () => ({
      default: async () => {
        calls.push('aliveCheck');
        return aliveImpl();
      },
    }));
    vi.doMock(root + '/lib/services/listings/travelTimeSweeper.js', () => ({
      default: async () => {
        calls.push('travelTimes');
      },
    }));
    vi.doMock(root + '/lib/services/logger.js', () => ({
      default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    }));
    return import(modPath);
  }

  beforeEach(() => {
    stored = {};
    aliveImpl = async () => {};
  });

  it('runs every sweep when nothing has run yet, and records when', async () => {
    const mod = await load();
    const now = 1_700_000_000_000;
    const ran = await mod.runMaintenance({ now });
    expect(ran).toEqual(['geocode', 'aliveCheck', 'travelTimes']);
    expect(calls).toEqual(['geocode', 'aliveCheck', 'travelTimes']);
    expect(upserts).toEqual([{ [mod.MAINTENANCE_SETTING]: { geocode: now, aliveCheck: now, travelTimes: now } }]);
  });

  it('paces the alive check at four hours and the travel sweep at two, geocoding every time', async () => {
    const mod = await load();
    const t0 = 1_700_000_000_000;
    stored = { [mod.MAINTENANCE_SETTING]: { geocode: t0, aliveCheck: t0, travelTimes: t0 } };

    expect(mod.dueSweeps(stored[mod.MAINTENANCE_SETTING], t0 + 15 * 60 * 1000)).toEqual(['geocode']);
    expect(mod.dueSweeps(stored[mod.MAINTENANCE_SETTING], t0 + 2 * HOUR)).toEqual(['geocode', 'travelTimes']);
    expect(mod.dueSweeps(stored[mod.MAINTENANCE_SETTING], t0 + 4 * HOUR)).toEqual([
      'geocode',
      'aliveCheck',
      'travelTimes',
    ]);

    const ran = await mod.runMaintenance({ now: t0 + 2 * HOUR });
    expect(ran).toEqual(['geocode', 'travelTimes']);
    expect(stored[mod.MAINTENANCE_SETTING]).toEqual({
      geocode: t0 + 2 * HOUR,
      aliveCheck: t0,
      travelTimes: t0 + 2 * HOUR,
    });
  });

  it('treats a sweep that fails inside as run, so a broken probe does not fire on every trigger', async () => {
    const mod = await load();
    aliveImpl = async () => {
      throw new Error('portal down');
    };
    const now = 1_700_000_000_000;
    const ran = await mod.runMaintenance({ now });
    expect(ran).toContain('aliveCheck');
    expect(stored[mod.MAINTENANCE_SETTING].aliveCheck).toBe(now);
  });

  it('survives a settings store failure without throwing into the trigger', async () => {
    const mod = await load();
    vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
      getSettings: async () => {
        throw new Error('firestore unavailable');
      },
      upsertSettings: async () => {},
    }));
    vi.resetModules();
    const broken = await import(modPath);
    await expect(broken.runMaintenance({ now: 1 })).resolves.toEqual([]);
    expect(mod.MAINTENANCE_PACE_MS.geocode).toBe(0);
  });
});
