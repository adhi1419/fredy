/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect, vi } from 'vitest';
import { mockFredy } from './utils.js';
import * as mockStore from './mocks/mockStore.js';

describe('Issue reproduction: listings filtered by similarity or area should be marked as manually deleted', () => {
  it('should call deleteListingsById when listings are filtered by similarity', async () => {
    const Fredy = await mockFredy();

    const mockSimilarityCache = {
      checkAndAddEntry: vi.fn(() => true), // always similar
    };

    const providerConfig = {
      url: 'http://example.com',
      getListings: () =>
        Promise.resolve([{ id: '1', title: 'test', address: 'addr', price: '100', link: 'http://example.com/1' }]),
      normalize: (l) => l,
      filter: () => true,
      crawlFields: { id: 'id', title: 'title', address: 'address', price: 'price' },
      requiredFieldNames: ['id', 'title', 'address', 'price'],
    };

    const mockedJob = {
      id: 'test-job',
      notificationAdapter: null,
      specFilter: null,
      spatialFilter: null,
    };

    const fredy = new Fredy(providerConfig, mockedJob, 'test-provider', mockSimilarityCache, undefined);

    // Clear deletedIds before test
    mockStore.deletedIds.length = 0;

    try {
      await fredy.execute();
    } catch {
      // Might throw NoNewListingsWarning if all are filtered out
    }

    expect(mockStore.deletedIds).toContain('1');
    // The provider id travels with the listing: the cache only ever treats two listings as the
    // same flat when they came from different providers.
    expect(mockSimilarityCache.checkAndAddEntry).toHaveBeenCalledWith({
      jobId: 'test-job',
      provider: 'test-provider',
      title: 'test',
      address: 'addr',
      price: '100',
      size: undefined,
      rooms: undefined,
      description: undefined,
    });
  });

  it('calls a custom getListings with the prepared url, bound to the pipeline', async () => {
    const Fredy = await mockFredy();
    const getListings = vi.fn(async () => []);
    const providerConfig = {
      url: 'http://example.com',
      getListings,
      normalize: (listing) => listing,
      filter: () => true,
      crawlFields: {},
      requiredFieldNames: [],
    };
    const mockedJob = {
      id: 'custom-get-listings',
      notificationAdapter: null,
      specFilter: null,
      spatialFilter: null,
    };

    const fredy = new Fredy(providerConfig, mockedJob, 'custom-provider', {}, undefined);
    await fredy.execute();

    // The pipeline fetches over plain HTTP now, so getListings receives only the url - no browser.
    expect(getListings).toHaveBeenCalledWith('http://example.com');
    expect(getListings.mock.contexts[0]).toBe(fredy);
  });

  it('should call deleteListingsById when listings are filtered by area', async () => {
    const Fredy = await mockFredy();

    const mockSimilarityCache = {
      checkAndAddEntry: () => false, // never similar
    };

    const spatialFilter = {
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };

    const mockedJob = {
      id: 'test-job',
      notificationAdapter: null,
      specFilter: null,
      spatialFilter: spatialFilter,
    };

    const providerConfig = {
      url: 'http://example.com',
      getListings: () =>
        Promise.resolve([
          {
            id: '2',
            title: 'test',
            address: 'addr',
            price: '100',
            latitude: 2,
            longitude: 2,
            link: 'http://example.com/2',
          },
        ]), // outside polygon
      normalize: (l) => l,
      filter: () => true,
      crawlFields: { id: 'id', title: 'title', address: 'address', price: 'price' },
      requiredFieldNames: ['id', 'title', 'address', 'price'],
    };

    const fredy = new Fredy(providerConfig, mockedJob, 'test-provider', mockSimilarityCache, undefined);

    mockStore.deletedIds.length = 0;

    try {
      await fredy.execute();
    } catch {
      // Might throw NoNewListingsWarning if all are filtered out
    }

    expect(mockStore.deletedIds).toContain('2');
  });
});
