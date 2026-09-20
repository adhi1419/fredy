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
const homeSource = fs.readFileSync(path.join(root, 'ui/src/views/home/Home.tsx'), 'utf8');
const homeStyles = fs.readFileSync(path.join(root, 'ui/src/views/home/Home.less'), 'utf8');
const navigationStyles = fs.readFileSync(path.join(root, 'ui/src/components/navigation/Navigate.less'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui/src/App.tsx'), 'utf8');
const navigationSource = fs.readFileSync(path.join(root, 'ui/src/components/navigation/Navigation.tsx'), 'utf8');

describe('Home production surface contract', () => {
  it('mounts Home at dashboard without changing account, admin, or detail route ownership', () => {
    expect(appSource).toContain("import Home from './views/home/Home';");
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.jsx'))).toBe(false);
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
    expect(homeSource).toContain('className="home__heading"');
    expect(homeSource).toContain("t('home.heading')");
    expect(homeSource).toContain('home__card-media');
    expect(homeSource).toContain('dashboard?.general?.lastRun');
    expect(homeSource).toContain('formatHomeContext');
    expect(homeSource).toContain("t('home.updatedNever')");
    expect(homeSource).not.toContain('Headline');
    expect(homeSource).toContain('withReturnTo(`/listings/listing/${id}`');
    expect(homeSource).not.toContain('FredyPipelineExecutioner');
  });

  it('keeps List + map inside Home and gives mobile controls reachable targets', () => {
    expect(homeSource).toContain('HOME_VIEWS.map');
    expect(homeSource).toContain('<HomeMap listings={listings} onNavigate={navigateToListing} />');
    expect(homeSource).toContain('constrainToCountries={false}');
    expect(homeSource).toContain(
      'listings.map(homeMapListing).filter((listing): listing is HomeMapListing => listing !== null)',
    );
    expect(homeSource).toContain('home__card--no-image');
    expect(homeSource).toContain(
      "const markerElement = grouped.length > 1 ? document.createElement('button') : undefined;",
    );
    expect(homeSource).toContain('homeMapMarkerAction(grouped, trigger)');
    expect(homeSource).toContain('setActiveGroup(action.listings)');
    expect(homeSource).toContain('className="home__map-chooser"');
    expect(homeSource).toContain('homeMapGroupSelectionId(activeGroup, id)');
    expect(homeSource).toContain('firstChooserOption.current?.focus()');
    expect(homeSource).toContain('const activeGroupTrigger = useRef<HTMLElement | null>(null);');
    expect(homeSource).toContain('activeGroupTrigger.current = element;');
    expect(homeSource).toContain('const closeGroupChooser = useCallback(() => {');
    expect(homeSource).toContain('restoreHomeMapMarkerFocus(trigger);');
    expect(homeSource).toContain("event.key === 'Escape'");
    expect(homeSource).toContain("document.addEventListener('keydown', closeOnEscape)");
    expect(homeSource).toContain("document.removeEventListener('keydown', closeOnEscape)");
    expect(homeSource).toContain('onClick={closeGroupChooser}');
    expect(homeSource).toContain('activeGroupTrigger.current = null;');
    expect(homeStyles).toContain('&__map-marker');
    expect(homeStyles).toContain('&__map-chooser');
    expect(homeStyles).toContain('width: 44px');
    expect(homeStyles).toContain('height: 44px');
    expect(homeStyles).toContain('&__card--no-image');
    expect(homeStyles).toContain('&__heading');
    expect(homeStyles).toContain('&-placeholder');
    expect(homeStyles).toMatch(/min-height:\s*44px/g);
    expect(homeStyles).toContain('@media (max-width: 768px)');
    expect(homeStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toContain('Headline.jsx');
  });

  it('preserves Home query state through the Home model instead of copying every route query', () => {
    expect(navigationSource).toContain('homeSearchForNavigation(location.pathname, location.search)');
    expect(navigationSource).not.toContain("path === '/dashboard' && location.search");
  });

  it('keeps search Enter-only and uses neutral accessible representation controls', () => {
    expect(homeSource).toContain('onSubmit={submitSearch}');
    expect(homeSource).not.toContain('htmlType="submit"');
    expect(homeSource).not.toContain("t('home.searchAction')");
    expect(homeSource).toContain('IconListView');
    expect(homeSource).toContain('IconRoute');
    expect(homeSource).toContain("t(view === 'feed' ? 'home.listView' : 'home.mapView')");
    expect(homeSource).not.toContain("t(view === 'feed' ? 'home.feedView' : 'home.mapView')");
    expect(homeSource).toContain('aria-label={label}');
    expect(homeSource).toContain('title={label}');
    expect(homeSource).toContain('aria-pressed={values.view === view}');
    expect(fs.readFileSync(path.join(root, 'ui/src/locales/en.json'), 'utf8')).toContain(
      '"home.listView": "List view"',
    );
    expect(fs.readFileSync(path.join(root, 'ui/src/locales/en.json'), 'utf8')).toContain('"home.mapView": "Map view"');
    expect(homeStyles).toContain('height: 72px');
    expect(homeStyles).toContain('min-height: 72px');
    expect(homeStyles).toContain('grid-template-rows: 56px');
    expect(navigationStyles).toContain('min-height: calc(64px + env(safe-area-inset-bottom))');
  });

  it('uses the compact provider picker and keeps stale selections clearable', () => {
    expect(homeSource).toContain('<details className="home__provider-picker">');
    expect(fs.readFileSync(path.join(root, 'ui/src/locales/de.json'), 'utf8')).not.toContain('Liste + Karte');
    expect(fs.readFileSync(path.join(root, 'ui/src/locales/tr.json'), 'utf8')).not.toContain('Liste + harita');
    expect(homeSource).toContain('home.providerSelectedCount');
    expect(homeSource).toContain('home.providerUnavailable');
    expect(homeSource).toContain('const stale = selected');
    expect(homeSource).toContain('updateState({ providerIds: normalizeProviderIds(next), page: 1 })');
    expect(homeStyles).toContain('min-width: 44px');
    expect(homeStyles).toContain('min-height: 44px');
  });

  it('carries exact Home context into detail and consumes the safe return path', () => {
    expect(homeSource).toContain('withReturnTo(`/listings/listing/${id}`');
    expect(fs.readFileSync(path.join(root, 'ui/src/views/listings/ListingDetail.tsx'), 'utf8')).toContain(
      "sanitizeReturnTo(searchParams.get('returnTo'))",
    );
    expect(fs.readFileSync(path.join(root, 'ui/src/views/listings/ListingDetail.tsx'), 'utf8')).toContain(
      'returnTo ? navigate(returnTo) : navigate(-1)',
    );
  });

  it('keeps the approved tokenized display treatment and no literal Home colors', () => {
    expect(fs.readFileSync(path.join(root, 'ui/src/tokens.less'), 'utf8')).toContain('@font-display');
    expect(homeStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('paints the activity pills with the forest/sage semantic roles', () => {
    // The activity pill scope: inactive text is Fredy's sage/green accent, the selected pill is the
    // deep forest solid fill with white (on-accent) text. All expressed as tokens, no literals.
    const activityScope = homeStyles.slice(
      homeStyles.indexOf('&__activities {'),
      homeStyles.indexOf('&__sort-provider'),
    );
    expect(activityScope).toMatch(/button\s*{[^}]*color:\s*@color-accent;/s);
    expect(activityScope).toMatch(/&\.is-selected\s*{[^}]*background:\s*@color-accent-fill;/s);
    expect(activityScope).toMatch(/&\.is-selected\s*{[^}]*color:\s*@color-on-accent;/s);
    // The white-on-forest foreground token is aliased in tokens.less onto a themed custom property.
    expect(fs.readFileSync(path.join(root, 'ui/src/tokens.less'), 'utf8')).toContain(
      '@color-on-accent: var(--f-on-accent);',
    );
  });
});
