/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const homeSource = read('ui/src/views/home/Home.tsx');
const homeStyles = read('ui/src/views/home/Home.less');
const appSource = read('ui/src/App.tsx');
const navigationSource = read('ui/src/components/navigation/Navigation.tsx');
const navigationStyles = read('ui/src/components/navigation/Navigate.less');

// A minimal listing shaped like the API result the Home table returns.
interface MockListing {
  id: string;
  title: string;
  address: string;
  provider: string;
  price: number;
  size?: number;
  rooms?: number;
  image_url?: string | null;
  created_at?: number;
  lifecycle?: { state: string };
  travelTimes?: unknown[];
}

const APPLIED: MockListing = {
  id: 'l1',
  title: 'Bright Altbau near Viktoriapark',
  address: 'Kreuzberg',
  provider: 'ImmoScout24',
  price: 1480,
  size: 64,
  rooms: 2,
  image_url: 'https://images.example.com/altbau.jpg',
  created_at: 1_700_000_000_000,
  lifecycle: { state: 'applied' },
  travelTimes: [
    { label: 'Work', mode: 'transit', transit: { minutes: 18 }, car: { minutes: 12, distanceMeters: 3800 } },
  ],
};

const NEW_NO_IMAGE: MockListing = {
  id: 'l2',
  title: 'Top-floor home with balcony',
  address: 'Neukölln',
  provider: 'Immowelt',
  price: 1360,
  size: 57,
  rooms: 2,
  image_url: null,
  created_at: 1_700_000_000_000,
  lifecycle: { state: 'new' },
};

let mockListings: MockListing[] = [];

// The store is faked so Home renders against fixed listings without a network or Zustand runtime.
vi.mock('../../ui/src/services/state/store.js', () => ({
  useActions: () => ({ listingsData: { getListingsData: vi.fn().mockResolvedValue(undefined) } }),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      listingsData: { result: mockListings, totalNumber: mockListings.length, availableProviders: ['immoscout'] },
      provider: [{ id: 'immoscout', name: 'ImmoScout24' }],
    }),
}));

// The map half is never mounted in feed view, but both modules are imported at module load.
vi.mock('../../ui/src/components/map/maplibre.js', () => ({ default: { Marker: class {} } }));
vi.mock('../../ui/src/components/map/Map.jsx', () => ({ default: () => null }));
vi.mock('../../ui/src/hooks/useProviderCountries.js', () => ({ useProviderCountries: () => ['de'] }));

vi.mock('../../ui/src/services/i18n/i18n.jsx', () => ({
  useTranslation: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
  useLocale: () => 'en',
}));

vi.mock('../../ui/src/services/price/priceService.js', () => ({
  formatEuroPrice: (price: number) => `€${price}`,
}));

vi.mock('../../ui/src/services/time/timeService.js', () => ({ format: () => 'just now' }));

vi.mock('@douyinfe/semi-icons', async () => {
  const { createElement } = await import('react');
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement('svg', { ...props, 'data-icon': name });
  return {
    IconArrowDown: icon('arrow-down'),
    IconArrowUp: icon('arrow-up'),
    IconChevronDown: icon('chevron-down'),
    IconClock: icon('clock'),
    IconCrop: icon('crop'),
    IconListView: icon('list'),
    IconMapPin: icon('map-pin'),
    IconMore: icon('more'),
    IconPriceTag: icon('price-tag'),
    IconRoute: icon('route'),
    IconSearch: icon('search'),
    IconSort: icon('sort'),
    IconTickCircle: icon('tick-circle'),
    IconEyeOpened: icon('eye'),
  };
});

let Home: React.ComponentType<{ defaultView?: 'feed' | 'map' }>;

beforeEach(async () => {
  vi.resetModules();
  ({ default: Home } = await import('../../ui/src/views/home/Home'));
});

afterEach(() => {
  mockListings = [];
});

function renderHome(search = ''): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[`/dashboard${search}`]}>
      <Home />
    </MemoryRouter>,
  );
}

describe('Direction A stay-card Home surface', () => {
  it('renders a photo-led marketplace grid of stay cards', () => {
    mockListings = [APPLIED, NEW_NO_IMAGE];
    const html = renderHome();
    expect(html).toContain('home__grid');
    // Two cards, each an <article> photo-led card, not a horizontal map-pin row.
    expect(html.match(/class="home__card home__card--grid"/g)?.length).toBe(2);
    expect(html).toContain('home__card-media');
    expect(html).toContain('home__card-open');
    expect(html).not.toContain('home__feed');
    expect(html).not.toContain('HomeListingRow');
  });

  it('renders a safe no-referrer image, or a fallback placeholder when absent', () => {
    mockListings = [APPLIED, NEW_NO_IMAGE];
    const html = renderHome();
    expect(html).toContain('src="https://images.example.com/altbau.jpg"');
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    // The image-less listing falls back to the placeholder rather than a broken image.
    expect(html).toContain('home__card-placeholder');
  });

  it('floats the lifecycle badge over the photo only for acted-on states', () => {
    mockListings = [APPLIED, NEW_NO_IMAGE];
    const html = renderHome();
    // Applied carries the badge with its label and canonical tick glyph.
    expect(html).toContain('home__card-badge home__card-badge--applied');
    expect(html).toContain('home.activityApplied');
    expect(html).toContain('data-icon="tick-circle"');
    // New carries no badge (absence of action).
    expect(html).not.toContain('home__card-badge--new');
    // The overflow dots marker is present but non-interactive (no nested button).
    expect(html).toContain('home__card-dots');
  });

  it('leads card meta with travel duration + distance, and shows price', () => {
    mockListings = [APPLIED];
    const html = renderHome();
    expect(html).toContain('home__card-travel');
    // homeCardTravel picks the primary (transit) mode minutes and the car distance.
    expect(html).toContain('18 min');
    expect(html).toContain('3.8 km');
    expect(html).toContain('home.cardTo:Work');
    expect(html).toContain('€1480');
    // No affordability verdict competes with the travel fact.
    expect(html).not.toContain('AffordabilityChip');
  });

  it('renders true pill activity filters with the selected one pressed', () => {
    mockListings = [APPLIED];
    const html = renderHome('?activity=applied');
    expect(html).toContain('home__activities');
    expect(html).toContain('aria-pressed="true"');
    // Applied/Viewed filter pills reuse the same icon language as the badges.
    expect(html).toContain('home__activity-symbol');
  });

  it('renders a rounded search and icon view controls, no giant heading actions', () => {
    mockListings = [APPLIED];
    const html = renderHome();
    expect(html).toContain('home__search');
    expect(html).toContain('home__view-switch');
    expect(html).toContain('home.heading');
    // The giant Home attention banner and run/refresh actions are gone.
    expect(html).not.toContain('home__attention');
    expect(html).not.toContain('home.runSearches');
  });
});

describe('Home production surface contract', () => {
  it('mounts Home at dashboard and keeps detail routing while retiring the legacy list/map pages', () => {
    expect(appSource).toContain("import Home from './views/home/Home';");
    expect(appSource).toContain('<Route path="/dashboard" element={<Home />} />');
    expect(appSource).toContain('<Route path="/listings/listing/:listingId" element={<ListingDetail />} />');
    // The legacy index surfaces are no longer routed to their old page components.
    expect(appSource).not.toContain('element={<Listings />}');
    expect(appSource).not.toContain('element={<MapView />}');
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.jsx'))).toBe(false);
  });

  it('keeps one URL-backed Home state and one canonical listings action', () => {
    expect(homeSource).toContain('HOME_ACTIVITIES');
    expect(homeSource).toContain('providerIds');
    expect(homeSource).toContain('homeQueryFromState(values)');
    expect(homeSource).toContain('actions.listingsData.getListingsData(query)');
    expect(homeSource).toContain('homeLifecycleState(listing)');
    expect(homeSource).toContain('withReturnTo(`/listings/listing/${id}`');
    expect(homeSource).not.toContain('FredyPipelineExecutioner');
  });

  it('carries exact Home context into detail and consumes the safe return path', () => {
    expect(homeSource).toContain('withReturnTo(`/listings/listing/${id}`');
    const detail = read('ui/src/views/listings/ListingDetail.tsx');
    expect(detail).toContain("sanitizeReturnTo(searchParams.get('returnTo'))");
    expect(detail).toContain('returnTo ? navigate(returnTo) : navigate(-1)');
  });

  it('uses tokenized colours only - no literal hex in the Home surface or styles', () => {
    expect(read('ui/src/tokens.less')).toContain('@color-on-accent: var(--f-on-accent);');
    expect(homeStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(homeSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    // No emoji in the Home surface: lifecycle uses Semi glyphs only.
    expect(homeSource).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('paints the marketplace pills and cards with forest/sage semantic roles and sans type', () => {
    // Title type is the sans UI face, not the serif display face this surface used to lead with.
    expect(homeStyles).toMatch(/&__card-title\s*{[^}]*font-family:\s*@font-ui/s);
    expect(homeStyles).toMatch(/&__heading h1\s*{[^}]*font-family:\s*@font-ui/s);
    expect(homeStyles).not.toContain('@font-display');
    // Inactive activity pill reads in sage accent; selected pill is deep forest fill + on-accent.
    const activityScope = homeStyles.slice(
      homeStyles.indexOf('&__activities {'),
      homeStyles.indexOf('&__activity-symbol'),
    );
    expect(activityScope).toMatch(/button\s*{[^}]*color:\s*@color-accent;/s);
    expect(activityScope).toMatch(/&\.is-selected\s*{[^}]*background:\s*@color-accent-fill;/s);
    expect(activityScope).toMatch(/&\.is-selected\s*{[^}]*color:\s*@color-on-accent;/s);
    // Reachable targets and the photo-led grid.
    expect(homeStyles).toMatch(/min-height:\s*44px/);
    expect(homeStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(homeStyles).toContain('@media (max-width: 768px)');
  });
});

describe('iPhone 13 Home containment', () => {
  it('keeps all four lifecycle scopes in one horizontally scrollable row', () => {
    const narrow = homeStyles.slice(homeStyles.indexOf('@media (max-width: 430px)'));
    // The preferred layout: a single non-wrapping, horizontally scrollable row, not a 2-col grid.
    expect(narrow).toMatch(/&__activities\s*{[\s\S]*?display:\s*flex;/);
    expect(narrow).toMatch(/&__activities\s*{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(narrow).toMatch(/&__activities\s*{[\s\S]*?overflow-x:\s*auto;/);
    expect(narrow).not.toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
  });

  it('keeps the open provider menu inside the full-width picker', () => {
    const narrow = homeStyles.slice(homeStyles.indexOf('@media (max-width: 430px)'));
    expect(narrow).toMatch(
      /&__provider-options\s*{[\s\S]*?right:\s*0;[\s\S]*?left:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/,
    );
  });
});

describe('Home view switch, sort, and card age', () => {
  it('enlarges the map view-switch glyph so it reads visibly larger than the list glyph', () => {
    expect(homeSource).toContain('className="home__view-icon--map"');
    expect(homeStyles).toMatch(/\.home__view-icon--map\s*{[^}]*font-size:\s*1\.5em/s);
  });

  it('keeps the icon-only view switch beside the search bar on mobile, not on its own row', () => {
    const mobile = homeStyles.slice(
      homeStyles.indexOf('@media (max-width: 768px)'),
      homeStyles.indexOf('@media (max-width: 430px)'),
    );
    // The row does not wrap and the search no longer takes the full width that pushed the switch down.
    expect(mobile).toMatch(/&__query-row\s*{[^}]*flex-wrap:\s*nowrap/s);
    expect(mobile).toMatch(/&__search\s*{[^}]*flex:\s*1 1 auto/s);
    expect(mobile).not.toMatch(/&__search\s*{[^}]*flex:\s*1 1 100%/s);
    expect(mobile).toMatch(
      /&__view-switch\s*{[\s\S]*?border:\s*1px solid @color-border;[\s\S]*?border-radius:\s*@radius-pill;/,
    );
  });

  it('gives provider roughly seventy percent and keeps icon sorts scrollable in the remainder', () => {
    const mobile = homeStyles.slice(
      homeStyles.indexOf('@media (max-width: 768px)'),
      homeStyles.indexOf('@media (max-width: 430px)'),
    );
    expect(mobile).toMatch(/&__providers\s*{[\s\S]*?flex:\s*7 1 0;/);
    expect(mobile).toMatch(/&__sort\s*{[\s\S]*?flex:\s*3 1 0;[\s\S]*?overflow-x:\s*auto;/);
  });

  it('renders an icon-based sort control with a visible direction arrow, no text select', () => {
    mockListings = [APPLIED];
    const html = renderHome();
    expect(html).toContain('home__sort');
    expect(html).toContain('home__sort-symbol');
    // Default sort is newest (created_at, desc): the active criterion shows the down arrow.
    expect(html).toContain('home__sort-direction');
    // The old text <select> is gone; the control is a group of buttons with aria labels.
    expect(html).not.toContain('<select');
    expect(html).toContain('home.sortActiveLabel');
  });

  it('flips the active sort direction in place and activates another criterion via chooseSort', () => {
    expect(homeSource).toContain('const chooseSort = (option: HomeSortOption) => {');
    expect(homeSource).toContain("updateState({ dir: activeDirection === 'asc' ? 'desc' : 'asc', page: 1 })");
    expect(homeSource).toContain('updateState({ sort: option.key, dir: option.direction, page: 1 })');
  });

  it('shows a relative age line on every card, replacing the absolute timestamp', () => {
    mockListings = [APPLIED, NEW_NO_IMAGE];
    const html = renderHome();
    expect(html.match(/class="home__card-age"/g)?.length).toBe(2);
    expect(homeSource).toContain('relativeListingAge(listing.created_at)');
    // The absolute timestamp fallback the card used to show is gone.
    expect(homeSource).not.toContain('formatTime');
  });
});

describe('Home keyboard and mobile health accessibility', () => {
  it('supports arrow, Home, and End navigation in both Home menus', () => {
    expect(homeSource).toContain('function moveMenuFocus(');
    expect(homeSource).toContain("event.key === 'ArrowDown'");
    expect(homeSource).toContain("event.key === 'ArrowUp'");
    expect(homeSource).toContain("event.key === 'Home'");
    expect(homeSource).toContain("event.key === 'End'");
    expect(homeSource.match(/moveMenuFocus\(event\.nativeEvent/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the attention count visible on mobile while retaining the full aria label', () => {
    expect(navigationSource).toContain('className="fredy-shell-nav__health-count"');
    expect(navigationSource).toContain('{attentionCount}');
    expect(navigationStyles).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.fredy-shell-nav__health-count\s*{[\s\S]*?display:\s*inline-block;/,
    );
  });
});
