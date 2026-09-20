/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { withReturnTo, sanitizeReturnTo } from '../../ui/src/services/routes/returnTo.js';
import { groupListingsByPosition } from '../../ui/src/views/listings/mapUtils.js';
import {
  homeListingNavigationId,
  homeMapListing,
  homeMapMarkerTarget,
  homeSearchForNavigation,
  readHomeViewState,
  writeHomeViewState,
  type HomeListing,
  type HomeMapListing,
} from '../../ui/src/services/home/homeViewState.js';

const listing = (id: string | undefined, latitude: number | null, longitude: number | null): HomeListing => ({
  id,
  title: id ? `Home ${id}` : 'Unaddressable home',
  address: 'Kreuzberg',
  provider: 'immoscout',
  latitude,
  longitude,
});

describe('Home list and map convergence', () => {
  it('switches representation without dropping query, activity, provider, sort, or page state', () => {
    const initial = new URLSearchParams(
      'q=Kreuzberg&activity=applied&provider=immoscout%2Cimmowelt&sort=price&dir=asc&page=2&source=legacy',
    );

    const mapParams = writeHomeViewState(initial, { view: 'map' });
    const mapState = readHomeViewState(mapParams);
    expect(mapState).toMatchObject({
      view: 'map',
      q: 'Kreuzberg',
      activity: 'applied',
      providerIds: ['immoscout', 'immowelt'],
      sort: 'price',
      dir: 'asc',
      page: 2,
    });
    expect(mapParams.get('source')).toBe('legacy');

    const listParams = writeHomeViewState(mapParams, { view: 'feed' });
    expect(readHomeViewState(listParams)).toMatchObject({ ...mapState, view: 'feed' });
    expect(listParams.has('view')).toBe(false);
  });

  it('round-trips the exact Home URL context through listing detail navigation', () => {
    const homeSearch = '?view=map&q=Kreuzberg&activity=applied&provider=immoscout&page=2';
    const detailUrl = withReturnTo('/listings/listing/listing-42', `/dashboard${homeSearch}`);
    const returnTo = new URLSearchParams(detailUrl.split('?')[1]).get('returnTo');

    expect(returnTo).toBe(`/dashboard${homeSearch}`);
    expect(sanitizeReturnTo(returnTo)).toBe(`/dashboard${homeSearch}`);
    expect(homeSearchForNavigation('/listings/listing/listing-42', homeSearch)).toBe(homeSearch);
  });

  it('feeds the same addressable listing IDs to rows and map markers', () => {
    const sourceListings = [
      listing('listing-1', 52.5, 13.4),
      listing(undefined, 52.51, 13.41),
      listing('listing-3', null, null),
    ];
    const mapListings = sourceListings.map(homeMapListing).filter((value): value is HomeMapListing => value !== null);

    expect(sourceListings.map(homeListingNavigationId)).toEqual(['listing-1', null, 'listing-3']);
    expect(mapListings.map(homeListingNavigationId)).toEqual(['listing-1', null]);
    expect(mapListings.map(homeListingNavigationId).filter((id): id is string => id !== null)).toEqual(['listing-1']);
  });

  it('uses the same listing target for a grouped marker and its list row', () => {
    const mapListings = [
      listing(undefined, 52.5, 13.4),
      listing('listing-2', 52.5, 13.4),
      listing('listing-3', 52.51, 13.41),
    ]
      .map(homeMapListing)
      .filter((value): value is HomeMapListing => value !== null);
    const groups = groupListingsByPosition(mapListings);

    expect(groups).toHaveLength(2);
    expect(homeMapMarkerTarget(groups[0].listings)).toBe(homeListingNavigationId(mapListings[1]));
    expect(homeMapMarkerTarget(groups[1].listings)).toBe(homeListingNavigationId(mapListings[2]));
    expect(homeMapMarkerTarget([])).toBeNull();
  });
});
