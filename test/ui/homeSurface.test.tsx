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
    IconChevronDown: icon('chevron-down'),
    IconListView: icon('list'),
    IconMapPin: icon('map-pin'),
    IconMore: icon('more'),
    IconRoute: icon('route'),
    IconSearch: icon('search'),
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
