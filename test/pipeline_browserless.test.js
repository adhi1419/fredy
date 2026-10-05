/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockFredy } from './utils.js';
import { setKnownListingsForRepair, setUserSettings } from './mocks/mockStore.js';

/**
 * A provider that reads everything over plain HTTP must never start the shared browser: a cold
 * Chromium start is most of a run's time, and the image only ships Chromium for providers that
 * still need it.
 */
describe('browserless providers', () => {
  beforeEach(() => {
    setKnownListingsForRepair([]);
    setUserSettings({ provider_details: ['test-provider'] });
  });

  for (const browserless of [true, false]) {
    it(`${browserless ? 'never' : 'still'} launches the browser for detail pages when browserless=${browserless}`, async () => {
      const Fredy = await mockFredy();
      let launches = 0;
      const getBrowser = async () => {
        launches += 1;
        return { fake: true };
      };
      const detailCalls = [];
      const providerConfig = {
        url: 'https://provider.example/search',
        browserless,
        getListings: async () => [
          { id: 'listing-1', link: 'https://provider.example/1', title: 'Listing', address: 'Address', price: 900 },
        ],
        fetchDetails: async (listing, browser) => {
          detailCalls.push(browser);
          return listing;
        },
        normalize: (listing) => listing,
        filter: () => true,
        requiredFieldNames: ['id', 'link', 'title', 'address', 'price'],
      };
      const job = {
        id: 'job-1',
        userId: 'user-1',
        provider: [{ id: 'test-provider', applicationPolicy: { automatic: 'disabled' } }],
        notificationAdapter: [],
        specFilter: null,
        spatialFilter: null,
        commuteFilter: null,
      };
      const executioner = new Fredy(
        providerConfig,
        job,
        'test-provider',
        { checkAndAddEntry: () => false },
        getBrowser,
      );

      await executioner.execute();

      expect(detailCalls).toHaveLength(1);
      expect(launches).toBe(browserless ? 0 : 1);
      expect(detailCalls[0]).toEqual(browserless ? null : { fake: true });
    });
  }
});
