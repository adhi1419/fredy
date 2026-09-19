/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createHomeAddressSettings,
  HomeAddressValidationError,
} from '../../../lib/services/userSettings/homeAddressSettings.js';

describe('home-address settings domain module', () => {
  it('normalizes routing inputs and preserves the invalidation/retry policy', async () => {
    let stored = {};
    const invalidations = [];
    const sweeps = [];
    const geocode = vi.fn(async (address) => ({ lat: address.length, lng: address.length + 1 }));
    const service = createHomeAddressSettings({
      getUserSettings: async () => stored,
      getAddresses: (settings) => settings.home_addresses ?? [],
      getCountriesForUser: async () => ['de', 'at'],
      geocodeAddress: geocode,
      upsertSettings: async (values) => {
        stored = { ...stored, ...values };
      },
      updateDistancesForAddressChange: (userId, addresses) => invalidations.push({ userId, addresses }),
      runGeoCordTask: () => sweeps.push(true),
    });

    const first = await service.saveHomeAddresses({
      userId: 'user-1',
      homeAddresses: [{ label: 'Work', address: 'Office', mode: 'CAR', departure: { time: '8:05' } }],
    });

    expect(first).toEqual([
      {
        label: 'Work',
        address: 'Office',
        coords: { lat: 6, lng: 7 },
        mode: 'car',
        departure: { time: '08:05' },
      },
    ]);
    expect(geocode).toHaveBeenCalledWith('Office', ['de', 'at']);
    expect(invalidations).toHaveLength(1);
    expect(sweeps).toHaveLength(1);

    await service.saveHomeAddresses({
      userId: 'user-1',
      homeAddresses: [{ label: 'Work', address: 'Office', mode: 'CAR', departure: { time: '8:05' } }],
    });

    expect(invalidations).toHaveLength(1);
    expect(sweeps).toHaveLength(2);
  });

  it('keeps provider and user country lookup policy behind the same interface', async () => {
    const getCountriesForProviderIds = vi.fn(async () => ['fr']);
    const getCountriesForUser = vi.fn(async () => ['de', 'at']);
    const service = createHomeAddressSettings({ getCountriesForProviderIds, getCountriesForUser });

    await expect(service.getCountriesForLookup({ userId: 'user-1', providers: 'one, two' })).resolves.toEqual(['fr']);
    await expect(service.getCountriesForLookup({ userId: 'user-1', providers: ' ,' })).resolves.toEqual(['de', 'at']);
    expect(getCountriesForProviderIds).toHaveBeenCalledWith(['one', 'two']);
    expect(getCountriesForUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects duplicate labels as a domain validation error', async () => {
    const service = createHomeAddressSettings({
      getUserSettings: async () => ({}),
      getAddresses: () => [],
    });

    await expect(
      service.saveHomeAddresses({
        userId: 'user-1',
        homeAddresses: [
          { label: 'Home', address: 'First' },
          { label: ' home ', address: 'Second' },
        ],
      }),
    ).rejects.toBeInstanceOf(HomeAddressValidationError);
  });
});
