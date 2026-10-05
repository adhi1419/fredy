/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockFredy } from './utils.js';
import { setKnownListingsForRepair, setUserSettings } from './mocks/mockStore.js';

/**
 * Every provider reads over plain HTTP, so the pipeline never owns a browser: `fetchDetails` is
 * called with the listing alone, and the constructor's 5th positional argument is `options`, not a
 * browser accessor.
 */
describe('browserless pipeline', () => {
  beforeEach(() => {
    setKnownListingsForRepair([]);
    setUserSettings({ provider_details: ['test-provider'] });
  });

  it('enriches detail pages without ever handing fetchDetails a browser', async () => {
    const Fredy = await mockFredy();
    const detailArgCounts = [];
    const providerConfig = {
      url: 'https://provider.example/search',
      getListings: async () => [
        { id: 'listing-1', link: 'https://provider.example/1', title: 'Listing', address: 'Address', price: 900 },
      ],
      fetchDetails: async (listing, ...rest) => {
        detailArgCounts.push(rest.length);
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
    const executioner = new Fredy(providerConfig, job, 'test-provider', { checkAndAddEntry: () => false });

    await executioner.execute();

    // fetchDetails ran once, and it was handed only the listing - no trailing browser argument.
    expect(detailArgCounts).toEqual([0]);
  });
});
