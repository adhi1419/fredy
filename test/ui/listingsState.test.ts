/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createListingsDataState,
  createListingsEffects,
  type ListingsStateSetter,
} from '../../ui/src/services/state/listingsState.js';

function setup() {
  const state = { listingsData: createListingsDataState() };
  const get = vi.fn();
  const post = vi.fn();
  const stringify = vi.fn(() => 'encoded-query');
  const set: ListingsStateSetter = (updater) => Object.assign(state, updater(state));
  const effects = createListingsEffects(set, { get, post }, stringify);
  return { state, get, post, stringify, effects };
}

describe('listings state domain', () => {
  it('starts with the aggregate store listing fields', () => {
    expect(createListingsDataState()).toEqual({
      totalNumber: 0,
      page: 1,
      result: [],
      availableProviders: [],
      mapListings: [],
      currentListing: null,
      maxPrice: 0,
    });
  });

  it('loads paginated table data with the existing query contract', async () => {
    const { state, get, stringify, effects } = setup();
    const response = {
      totalNumber: 1,
      page: 3,
      result: [{ id: 'listing-1' }],
      availableProviders: ['immoscout', 'immowelt', 42],
    };
    get.mockResolvedValue({ status: 200, json: response });

    await effects.getListingsData({
      page: 3,
      pageSize: 40,
      freeTextFilter: 'berlin',
      sortfield: 'created_at',
      sortdir: 'desc',
      filter: { active: true, provider: 'immoscout' },
    });

    expect(stringify).toHaveBeenCalledWith(
      {
        page: 3,
        pageSize: 40,
        freeTextFilter: 'berlin',
        sortfield: 'created_at',
        sortdir: 'desc',
        active: true,
        provider: 'immoscout',
      },
      { skipNull: true, skipEmptyString: true },
    );
    expect(get).toHaveBeenCalledWith('/api/listings/table?encoded-query');
    expect(state.listingsData).toMatchObject({
      totalNumber: 1,
      page: 3,
      result: [{ id: 'listing-1' }],
      availableProviders: ['immoscout', 'immowelt'],
    });
    expect(state.listingsData.availableProviders).not.toBe(response.availableProviders);
  });

  it('maps map data and keeps the existing empty-value fallbacks', async () => {
    const { state, get, stringify, effects } = setup();
    get.mockResolvedValue({
      status: 200,
      json: { listings: [{ id: 'map-1' }], maxPrice: 1850 },
    });

    await effects.getListingsForMap({ jobId: 'job-1', minPrice: 500, maxPrice: 1850 });

    expect(stringify).toHaveBeenCalledWith(
      { jobId: 'job-1', minPrice: 500, maxPrice: 1850 },
      { skipNull: true, skipEmptyString: true },
    );
    expect(get).toHaveBeenCalledWith('/api/listings/map?encoded-query');
    expect(state.listingsData.mapListings).toEqual([{ id: 'map-1' }]);
    expect(state.listingsData.maxPrice).toBe(1850);
  });

  it('stores a fetched detail and returns the response unchanged', async () => {
    const { state, get, effects } = setup();
    const listing = { id: 'listing-1', address: 'Main Street' };
    get.mockResolvedValue({ status: 200, json: listing });

    await expect(effects.getListing('listing-1')).resolves.toBe(listing);
    expect(get).toHaveBeenCalledWith('/api/listings/listing-1');
    expect(state.listingsData.currentListing).toBe(listing);
  });

  it('keeps all listing mutation routes and payloads', async () => {
    const { post, effects } = setup();
    post.mockResolvedValue({ status: 200, json: {} });

    await effects.setListingStatus('listing-1', 'applied');
    await effects.setListingLifecycleAction('listing-1', 'applied');
    await effects.setListingLifecycleAction('listing-1', 'viewing');
    await effects.setListingLifecycleAction('listing-1', 'archive');
    await effects.setListingNotes('listing-1', 'call after 6pm');
    await effects.setListingAddress('listing-1', {
      address: 'New Street 4',
      latitude: 52.5,
      longitude: 13.4,
    });
    await effects.toggleListingWatch('listing-1');
    await effects.restoreListings(['listing-1']);
    await effects.reactivateListings(['listing-2']);

    expect(post.mock.calls).toEqual([
      ['/api/listings/listing-1/status', { status: 'applied' }],
      ['/api/listings/listing-1/status', { action: 'applied' }],
      ['/api/listings/listing-1/status', { action: 'viewing' }],
      ['/api/listings/listing-1/status', { action: 'archive' }],
      ['/api/listings/listing-1/notes', { notes: 'call after 6pm' }],
      ['/api/listings/listing-1/address', { address: 'New Street 4', latitude: 52.5, longitude: 13.4 }],
      ['/api/listings/watch', { listingId: 'listing-1' }],
      ['/api/listings/restore', { ids: ['listing-1'] }],
      ['/api/listings/reactivate', { ids: ['listing-2'] }],
    ]);
  });

  it('rethrows mutation failures for existing callers to handle', async () => {
    const { post, effects } = setup();
    const failure = new Error('unauthorized');
    post.mockRejectedValue(failure);

    await expect(effects.setListingStatus('listing-1', 'available')).rejects.toBe(failure);
  });
});
