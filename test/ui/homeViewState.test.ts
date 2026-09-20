/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  HOME_ACTIVITIES,
  HOME_SORT_OPTIONS,
  homeLifecycleState,
  homeMapListing,
  homeProviderOptions,
  homeQueryFromState,
  homeSearchForNavigation,
  homeSortOption,
  normalizeProviderIds,
  providerParamFromIds,
  readHomeViewState,
  writeHomeViewState,
} from '../../ui/src/services/home/homeViewState.js';

describe('homeViewState', () => {
  it('opens as a quiet New feed with newest-first sorting', () => {
    expect(readHomeViewState(new URLSearchParams())).toEqual({
      view: 'feed',
      q: null,
      activity: 'new',
      providerIds: [],
      sort: 'created_at',
      dir: 'desc',
      page: 1,
    });
  });

  it('normalizes repeated and comma-separated provider selections', () => {
    expect(normalizeProviderIds([' immoscout,immowelt', 'immoscout', ''])).toEqual(['immoscout', 'immowelt']);
    expect(providerParamFromIds(['immoscout', 'immowelt', 'immoscout'])).toBe('immoscout,immowelt');

    const values = readHomeViewState(new URLSearchParams('provider=immoscout&provider=immowelt'));
    expect(values.providerIds).toEqual(['immoscout', 'immowelt']);
  });

  it('derives provider controls from the accessible listing providers', () => {
    expect(
      homeProviderOptions(
        [
          { id: 'immoscout', name: 'ImmoScout24' },
          { id: 'immowelt', name: 'Immowelt' },
          { id: 'configured-only', name: 'Configured Only' },
        ],
        ['immowelt', 'immoscout'],
      ),
    ).toEqual([
      { id: 'immowelt', name: 'Immowelt' },
      { id: 'immoscout', name: 'ImmoScout24' },
    ]);
  });

  it('renders no unselected providers when availability is explicitly empty', () => {
    expect(
      homeProviderOptions(
        [
          { id: 'immoscout', name: 'ImmoScout24' },
          { id: 'immowelt', name: 'Immowelt' },
        ],
        [],
      ),
    ).toEqual([]);
  });

  it('uses the provider ID when availability has no matching metadata', () => {
    expect(homeProviderOptions([{ id: 'immoscout', name: 'ImmoScout24' }], ['new-provider'])).toEqual([
      { id: 'new-provider', name: 'new-provider' },
    ]);
  });

  it('retains a stale selected provider so it can be cleared', () => {
    expect(homeProviderOptions([{ id: 'immoscout', name: 'ImmoScout24' }], [], ['retired-provider'])).toEqual([
      { id: 'retired-provider', name: 'retired-provider' },
    ]);
  });

  it('does not mutate provider metadata, availability, or selection inputs', () => {
    const metadata = [{ id: 'immoscout', name: 'ImmoScout24' }];
    const availableProviders = ['immoscout'];
    const selectedProviderIds = ['stale-provider'];

    homeProviderOptions(metadata, availableProviders, selectedProviderIds);

    expect(metadata).toEqual([{ id: 'immoscout', name: 'ImmoScout24' }]);
    expect(availableProviders).toEqual(['immoscout']);
    expect(selectedProviderIds).toEqual(['stale-provider']);
  });

  it('maps legacy listings status and sort aliases without losing the view state', () => {
    const values = readHomeViewState(
      new URLSearchParams('status=viewing&sortfield=distance&sortdir=asc&page=2'),
      'map',
    );
    expect(values).toMatchObject({ view: 'map', activity: 'viewed', sort: 'distance', dir: 'asc', page: 2 });
    expect(readHomeViewState(new URLSearchParams('status=accepted')).activity).toBe('archived');
    expect(readHomeViewState(new URLSearchParams('status=rejected')).activity).toBe('archived');
  });

  it('writes one canonical URL update while preserving unrelated adapter params', () => {
    const params = writeHomeViewState(new URLSearchParams('source=legacy&status=applied&sortfield=price&sortdir=asc'), {
      view: 'map',
      activity: 'archived',
      providerIds: ['immoscout', 'immowelt'],
      sort: 'distance',
      dir: 'asc',
      page: 1,
    });

    expect(params.toString()).toBe(
      'source=legacy&view=map&activity=archived&provider=immoscout%2Cimmowelt&sort=distance',
    );
  });

  it('maps the mutually exclusive Home activity to the existing table query contract', () => {
    expect(HOME_ACTIVITIES).toEqual(['new', 'applied', 'viewed', 'archived']);
    expect(
      homeQueryFromState({
        page: 3,
        q: 'Kreuzberg',
        activity: 'viewed',
        providerIds: ['immoscout', 'immowelt'],
        sort: 'travel_time',
        dir: 'asc',
      }),
    ).toEqual({
      page: 3,
      pageSize: 40,
      freeTextFilter: 'Kreuzberg',
      sortfield: 'travel_time',
      sortdir: 'asc',
      filter: { statusFilter: 'viewed', providerFilter: 'immoscout,immowelt' },
    });
  });

  it('keeps unknown future sort keys round-trippable', () => {
    expect(homeSortOption('commute_reliability')).toEqual({
      key: 'commute_reliability',
      direction: 'desc',
      labelKey: 'home.sortFuture',
    });
    expect(HOME_SORT_OPTIONS.map((option) => option.key)).toEqual([
      'created_at',
      'travel_time',
      'distance',
      'price',
      'size',
    ]);
  });

  it('preserves Home state only across compatible Home, listings, and map routes', () => {
    expect(homeSearchForNavigation('/dashboard', '?activity=applied')).toBe('?activity=applied');
    expect(homeSearchForNavigation('/listings/listing/42', '?activity=applied')).toBe('?activity=applied');
    expect(homeSearchForNavigation('/map', '?provider=immoscout')).toBe('?provider=immoscout&view=map');
    expect(homeSearchForNavigation('/map', '')).toBe('?view=map');
    expect(homeSearchForNavigation('/jobs', '?page=4')).toBe('');
    expect(homeSearchForNavigation('/finance', '?dealType=buy')).toBe('');
    expect(homeSearchForNavigation('/settings/preferences', '?tab=theme')).toBe('');
  });

  it('normalizes usable map coordinates and rejects missing, sentinel, or out-of-range values', () => {
    expect(homeMapListing({ id: 'valid', latitude: '52.5', longitude: '13.4' })).toMatchObject({
      id: 'valid',
      latitude: 52.5,
      longitude: 13.4,
    });
    expect(homeMapListing({ latitude: null, longitude: null })).toBeNull();
    expect(homeMapListing({ latitude: -1, longitude: -1 })).toBeNull();
    expect(homeMapListing({ latitude: 91, longitude: 13.4 })).toBeNull();
  });

  it('uses canonical lifecycle and compatibility evidence without reviving retired states', () => {
    expect(homeLifecycleState({ lifecycle: { state: 'archived' }, inquiry_send_status: 'sent' })).toBe('archived');
    expect(homeLifecycleState({ status: { status: 'accepted' } })).toBe('archived');
    expect(homeLifecycleState({ status: { status: 'rejected' } })).toBe('archived');
    expect(homeLifecycleState({ inquiry_send_status: 'sent' })).toBe('applied');
    expect(homeLifecycleState({ lifecycle: { state: 'unexpected' } })).toBe('new');
    expect(homeLifecycleState({})).toBe('new');
  });
});
