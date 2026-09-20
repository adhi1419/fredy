/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../');
const homeSource = fs.readFileSync(path.join(root, 'ui/src/views/home/Home.jsx'), 'utf8');
const homeStyles = fs.readFileSync(path.join(root, 'ui/src/views/home/Home.less'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui/src/App.jsx'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'ui/src/components/navigation/Navigation.jsx'), 'utf8');

describe('Home production surface contract', () => {
  it('mounts Home at dashboard without changing account, admin, or detail route ownership', () => {
    expect(appSource).toContain("import Home from './views/home/Home.jsx';");
    expect(appSource).toContain('<Route path="/dashboard" element={<Home />} />');
    expect(appSource).toContain('<Route path="/listings/listing/:listingId" element={<ListingDetail />} />');
    expect(appSource).toContain('path="/settings"');
    expect(appSource).toContain('path="/admin"');
  });

  it('uses one URL-backed Home state and one canonical listings action', () => {
    expect(homeSource).toContain('HOME_ACTIVITIES');
    expect(homeSource).toContain('aria-pressed={values.activity === activity}');
    expect(homeSource).toContain('providerIds');
    expect(homeSource).toContain('homeQueryFromState(values)');
    expect(homeSource).toContain('actions.listingsData.getListingsData(query)');
    expect(homeSource).toContain('homeLifecycleState(listing)');
    expect(homeSource).toContain('navigate(`/listings/listing/${id}`)');
    expect(homeSource).not.toContain('FredyPipelineExecutioner');
  });

  it('keeps List + map inside Home and gives mobile controls reachable targets', () => {
    expect(homeSource).toContain('HOME_VIEWS.map');
    expect(homeSource).toContain('<HomeMap listings={listings} onNavigate={navigateToListing} />');
    expect(homeSource).toContain('constrainToCountries={false}');
    expect(homeSource).toContain('listings.map(homeMapListing).filter(Boolean)');
    expect(homeSource).toContain('home__row--no-image');
    expect(homeStyles).toContain('&__row--no-image');
    expect(homeStyles).toMatch(/min-height:\s*44px/g);
    expect(homeStyles).toContain('@media (max-width: 768px)');
    expect(homeStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('preserves Home query state through the Home model instead of copying every route query', () => {
    expect(navigationSource).toContain('homeSearchForNavigation(location.pathname, location.search)');
    expect(navigationSource).not.toContain("path === '/dashboard' && location.search");
  });
});
