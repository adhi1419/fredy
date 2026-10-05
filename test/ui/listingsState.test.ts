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
  const stringify = vi.fn((_query: Record<string, unknown>) => 'encoded-query');
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
      pins: [],
      counts: null,
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

  it('appends the next page onto the rows already held and drops a page for a superseded query', async () => {
    const { state, get, stringify, effects } = setup();
    stringify.mockImplementation((query: Record<string, unknown>) => `${query.freeTextFilter}-${query.page}`);
    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 3, page: 1, result: [{ id: 'a' }] } });
    const base = { pageSize: 1, freeTextFilter: 'berlin', sortfield: 'created_at', sortdir: 'desc' };
    await effects.getListingsData({ ...base, page: 1 });

    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 3, page: 2, result: [{ id: 'b' }] } });
    await effects.appendListingsPage({ ...base, page: 2 });
    expect(state.listingsData.result).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(state.listingsData.page).toBe(2);

    // A page requested for a query that is no longer current never reaches the store.
    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 9, page: 2, result: [{ id: 'stale' }] } });
    await effects.appendListingsPage({ ...base, freeTextFilter: 'munich', page: 2 });
    expect(state.listingsData.result).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('lets a filter change win over an append that was in flight', async () => {
    const { state, get, stringify, effects } = setup();
    stringify.mockImplementation((query: Record<string, unknown>) => `${query.freeTextFilter}-${query.page}`);
    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 3, page: 1, result: [{ id: 'a' }] } });
    await effects.getListingsData({ pageSize: 1, freeTextFilter: 'berlin', page: 1 });

    let resolveAppend: (value: { status: number; json: unknown }) => void = () => {};
    get.mockReturnValueOnce(new Promise((resolve) => (resolveAppend = resolve)));
    const appending = effects.appendListingsPage({ pageSize: 1, freeTextFilter: 'berlin', page: 2 });

    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 1, page: 1, result: [{ id: 'm' }] } });
    await effects.getListingsData({ pageSize: 1, freeTextFilter: 'munich', page: 1 });
    resolveAppend({ status: 200, json: { totalNumber: 3, page: 2, result: [{ id: 'b' }] } });
    await appending;

    expect(state.listingsData.result).toEqual([{ id: 'm' }]);
  });

  it('fetches pins unpaginated through pins=true, ignoring page, size and sort, and drops a stale set', async () => {
    const { state, get, stringify, effects } = setup();
    stringify.mockImplementation((query: Record<string, unknown>) => JSON.stringify(query));
    get.mockResolvedValueOnce({
      status: 200,
      json: { totalNumber: 40, pins: [{ id: 'a', latitude: 52.5, longitude: 13.4 }] },
    });
    await effects.getListingsPins({
      page: 4,
      pageSize: 9,
      sortfield: 'price',
      sortdir: 'desc',
      filter: { statusFilter: 'new', bbox: '13,52,14,53', ids: 'x,y' },
    });
    const sent = JSON.parse(String(get.mock.calls[0][0]).replace('/api/listings/table?', ''));
    expect(sent).toMatchObject({ page: 1, pageSize: 1, statusFilter: 'new', bbox: '13,52,14,53', pins: true });
    expect(sent.sortfield).toBeNull();
    expect(state.listingsData.pins).toEqual([{ id: 'a', latitude: 52.5, longitude: 13.4 }]);

    // Two filter sets in flight: the one issued last wins, whatever order the responses land in.
    let resolveFirst: (value: { status: number; json: unknown }) => void = () => {};
    get.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    const first = effects.getListingsPins({ filter: { statusFilter: 'viewed' } });
    get.mockResolvedValueOnce({ status: 200, json: { totalNumber: 1, pins: [{ id: 'current' }] } });
    await effects.getListingsPins({ filter: { statusFilter: 'applied' } });
    resolveFirst({ status: 200, json: { totalNumber: 1, pins: [{ id: 'stale' }] } });
    await first;
    expect(state.listingsData.pins).toEqual([{ id: 'current' }]);
  });

  it('fetches the four activity counts without the status filter and coerces a bad payload to zeros', async () => {
    const { state, get, stringify, effects } = setup();
    stringify.mockImplementation((query: Record<string, unknown>) => JSON.stringify(query));
    get.mockResolvedValueOnce({ status: 200, json: { counts: { new: 4, applied: 1, viewed: 'x', archived: 7 } } });
    await effects.getListingsCounts({
      page: 3,
      sortfield: 'price',
      filter: { statusFilter: 'applied', providerFilter: 'immoscout', bbox: '1,2,3,4' },
    });
    const sent = JSON.parse(String(get.mock.calls[0][0]).replace('/api/listings/table?', ''));
    expect(sent).toMatchObject({ page: 1, counts: true, providerFilter: 'immoscout', bbox: '1,2,3,4' });
    expect(sent.statusFilter).toBeUndefined();
    expect(state.listingsData.counts).toEqual({ new: 4, applied: 1, viewed: 0, archived: 7 });
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

    await expect(effects.setListingLifecycleAction('listing-1', 'applied')).rejects.toBe(failure);
  });
});
