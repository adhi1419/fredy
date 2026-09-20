/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  LEGACY_REDIRECTS,
  legacyRedirectTarget,
  resolveLegacyPath,
  targetPathname,
} from '../../ui/src/services/routes/legacyRedirects.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, '../../ui/src/App.tsx'), 'utf8');

/**
 * Every path `App.tsx` declares a route for, children resolved against their parent.
 *
 * Read out of the source rather than listed here, because a list would be the thing that goes
 * stale: renaming a route in App.tsx has to break this test, not quietly agree with it.
 *
 * There are exactly two nested parents, `/settings` and `/admin`, and they are declared in that
 * order, so a relative path belongs to whichever of the two most recently opened above it.
 *
 * @returns {Set<string>}
 */
function declaredRoutes(): Set<string> {
  const settingsAt = appSource.indexOf('path="/settings"');
  const adminAt = appSource.indexOf('path="/admin"');
  const routes = new Set<string>();

  for (const match of appSource.matchAll(/path="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith('/')) {
      routes.add(value);
      continue;
    }
    const parent = match.index > adminAt ? '/admin' : '/settings';
    routes.add(`${parent}/${value}`);
  }

  // Guards the ordering assumption above: a relative path declared before either parent opens
  // would otherwise be filed under '/settings' without anyone noticing.
  if (settingsAt < 0 || adminAt < 0 || settingsAt > adminAt) {
    throw new Error('App.tsx no longer declares /settings before /admin; fix declaredRoutes()');
  }
  return routes;
}

describe('legacyRedirects', () => {
  const routes = declaredRoutes();

  it('reads the routes out of App.tsx rather than trusting a copy', () => {
    expect(routes.has('/admin')).toBe(true);
    expect(routes.has('/dashboard')).toBe(true);
    expect(routes.size).toBeGreaterThan(10);
  });

  it('resolves each nested child against the right parent', () => {
    for (const tab of ['preferences', 'travel-time', 'listings', 'notifications']) {
      expect(routes.has(`/settings/${tab}`)).toBe(true);
    }
    for (const tab of ['system', 'execution', 'backup', 'debug']) {
      expect(routes.has(`/admin/${tab}`)).toBe(true);
    }
  });

  it.each(Object.entries(LEGACY_REDIRECTS))('sends %s to a route that exists', (_from, to) => {
    expect(to.startsWith('/')).toBe(true);
    expect(routes.has(targetPathname(to))).toBe(true);
  });

  it('never redirects to another redirect', () => {
    for (const to of Object.values(LEGACY_REDIRECTS)) {
      expect(LEGACY_REDIRECTS[targetPathname(to)]).toBeUndefined();
    }
  });

  it('keeps every address that has actually moved working', () => {
    for (const old of ['/generalSettings', '/userSettings', '/settings/addresses']) {
      expect(resolveLegacyPath(old)).not.toBeNull();
    }
  });

  it('does not shadow a route that still exists', () => {
    for (const from of Object.keys(LEGACY_REDIRECTS)) {
      expect(routes.has(from)).toBe(false);
    }
  });

  it('folds the retired listings overview, its map, and the watchlist into canonical Home', () => {
    // The standalone list and map are Home now, not their own pages.
    expect(resolveLegacyPath('/listings')).toBe('/dashboard');
    expect(resolveLegacyPath('/map')).toBe('/dashboard?view=map');
    // The watchlist is gone entirely - it must NOT revive a Watch state.
    expect(resolveLegacyPath('/listings/watchlist')).toBe('/dashboard');
    expect(resolveLegacyPath('/watchlistManagement')).toBe('/dashboard');
    for (const to of Object.values(LEGACY_REDIRECTS)) {
      expect(to).not.toContain('watch=true');
    }
  });

  it('answers null for a path that was never moved', () => {
    expect(resolveLegacyPath('/dashboard')).toBeNull();
    expect(resolveLegacyPath('/nonsense')).toBeNull();
  });
});

describe('legacyRedirectTarget query preservation', () => {
  it('carries the safe subset of an incoming query into Home', () => {
    // A bookmarked /listings?sort=price&dir=asc keeps its sort intent on the way to Home. Params are
    // re-serialized in a canonical (allow-list) order, so the exact string is deterministic.
    expect(legacyRedirectTarget('/dashboard', '?sort=price&dir=asc&provider=immoscout%2Cimmowelt')).toBe(
      '/dashboard?provider=immoscout%2Cimmowelt&sort=price&dir=asc',
    );
  });

  it('applies the target intent over the incoming query for the map entry', () => {
    // /map forces the map view even if the incoming URL asked for a different view.
    expect(legacyRedirectTarget('/dashboard?view=map', '?view=feed&q=Kreuzberg')).toBe(
      '/dashboard?q=Kreuzberg&view=map',
    );
  });

  it('drops a revived Watch flag and any unknown params rather than forwarding them', () => {
    const result = legacyRedirectTarget('/dashboard', '?watch=true&activity=applied&utm_source=email');
    expect(result).toContain('activity=applied');
    expect(result).not.toContain('watch');
    expect(result).not.toContain('utm_source');
  });

  it('produces a bare path when nothing safe survives', () => {
    expect(legacyRedirectTarget('/dashboard', '?watch=true')).toBe('/dashboard');
    expect(legacyRedirectTarget('/dashboard', '')).toBe('/dashboard');
  });
});
