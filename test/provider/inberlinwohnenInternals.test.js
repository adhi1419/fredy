/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { expect, vi } from 'vitest';
import { providerConfig } from '../utils.js';
import * as provider from '../../lib/provider/inberlinwohnen.js';
import { buildHash } from '../../lib/utils.js';

/** Run-scoped provider config, built per test via createConfig(). */
let runConfig;

// The portal is a Livewire app, so all listing data lives in `wire:snapshot`
// attributes instead of markup. Every test here drives the provider with an
// injected page extractor, which means no browser and no network is involved.
const SEARCH_URL = providerConfig.inberlinwohnen.url;

const listingSnapshot = (item, tuple = true) => JSON.stringify({ data: { item: tuple ? [item, { s: 'arr' }] : item } });

const listingElement = (id) =>
  `<div wire:snapshot='${listingSnapshot({ id, title: `Listing ${id}`, deeplink: `/listing/${id}` })}'></div>`;

const paginationElement = (itemIds, itemsPerPage) =>
  `<div wire:snapshot='${JSON.stringify({ data: { itemIds: [itemIds, { s: 'arr' }], itemsPerPage } })}'></div>`;

const resultPage = (ids, pagination = null) =>
  `<!doctype html><html><body>${pagination ?? ''}${ids.map(listingElement).join('')}</body></html>`;

describe('#inberlinwohnen internals()', () => {
  beforeEach(() => {
    runConfig = provider.createConfig(providerConfig.inberlinwohnen, []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createConfig()', () => {
    it.each([
      ['/mein-bereich/wohnungsfinder', '/wohnungsfinder/'],
      ['/mein-bereich/wohnungsfinder/', '/wohnungsfinder/'],
    ])('should replace the saved private search path %s', (privatePath, publicPath) => {
      const privateUrl = `https://www.inberlinwohnen.de${privatePath}?q=opaque-filter&district=mitte`;

      const privateRunConfig = provider.createConfig({ url: privateUrl, enabled: true }, []);

      expect(privateRunConfig.url).toBe(`https://www.inberlinwohnen.de${publicPath}?q=opaque-filter&district=mitte`);
    });

    it('should leave public search URLs unchanged', () => {
      const publicUrl = 'https://www.inberlinwohnen.de/wohnungsfinder/?q=opaque-filter&district=mitte';

      expect(provider.createConfig({ url: publicUrl, enabled: true }, []).url).toBe(publicUrl);
    });
  });

  describe('getListings()', () => {
    it('should fetch every server-rendered result page', async () => {
      const pagination = paginationElement([1, 2, 3, 4, 5], 2);
      const extractPage = vi
        .fn()
        .mockResolvedValueOnce(resultPage([1, 2], pagination))
        .mockResolvedValueOnce(resultPage([3, 4]))
        .mockResolvedValueOnce(resultPage([5]));

      const listings = await runConfig.getListings(
        'https://inberlinwohnen.de/wohnungsfinder/?district=mitte&page=9',
        extractPage,
      );

      expect(listings).toHaveLength(5);
      expect(listings.map((listing) => JSON.parse(listing.id).data.item[0].id)).toEqual([1, 2, 3, 4, 5]);
      // the page parameter of the configured url must not leak into the crawl
      [1, 2, 3].forEach((page) => {
        expect(extractPage).toHaveBeenNthCalledWith(
          page,
          `https://inberlinwohnen.de/wohnungsfinder/?district=mitte&page=${page}`,
          { name: 'inberlinwohnen' },
        );
      });
    });

    it('should cap result-page concurrency at three', async () => {
      const ids = Array.from({ length: 8 }, (_, index) => index + 1);
      let active = 0;
      let peak = 0;
      const extractPage = vi.fn(async (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        if (page === 1) return resultPage([1], paginationElement(ids, 1));
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return resultPage([page]);
      });

      const listings = await runConfig.getListings(SEARCH_URL, extractPage);

      expect(listings).toHaveLength(8);
      expect(peak).toBe(3);
    });

    it('should deduplicate listings repeated across page boundaries', async () => {
      const extractPage = vi
        .fn()
        .mockResolvedValueOnce(resultPage([1, 2], paginationElement([1, 2, 3], 2)))
        .mockResolvedValueOnce(resultPage([2, 3]));

      const listings = await runConfig.getListings(SEARCH_URL, extractPage);

      expect(listings.map((listing) => JSON.parse(listing.id).data.item[0].id)).toEqual([1, 2, 3]);
    });

    it('should accept a recognized search without any results', async () => {
      const extractPage = vi.fn().mockResolvedValue(resultPage([], paginationElement([], 10)));

      await expect(runConfig.getListings(SEARCH_URL, extractPage)).resolves.toEqual([]);
    });

    it('should reject pages without recognizable Livewire search data', async () => {
      const unrelatedSnapshot = `<div wire:snapshot='${listingSnapshot({ id: 'unrelated' })}'></div>`;
      const extractPage = vi.fn().mockResolvedValue(`${paginationElement([1], 10)}${unrelatedSnapshot}`);

      await expect(runConfig.getListings(SEARCH_URL, extractPage)).rejects.toThrow(
        'contained 0 of 1 expected listings',
      );
    });

    it('should reject a later page that omits expected listings', async () => {
      const pagination = paginationElement([1, 2], 1);
      const extractPage = vi
        .fn()
        .mockResolvedValueOnce(resultPage([1], pagination))
        .mockResolvedValueOnce(pagination);

      await expect(runConfig.getListings(SEARCH_URL, extractPage)).rejects.toThrow(
        'page 2 contained 0 of 1 expected listings',
      );
    });

    it('should reject browser failures and excessive pagination', async () => {
      await expect(runConfig.getListings(SEARCH_URL, vi.fn().mockResolvedValue(null))).rejects.toThrow(
        'could not be loaded',
      );

      const tooManyPages = resultPage(
        [1],
        paginationElement(
          Array.from({ length: 101 }, (_, index) => index),
          1,
        ),
      );
      await expect(runConfig.getListings(SEARCH_URL, vi.fn().mockResolvedValue(tooManyPages))).rejects.toThrow(
        'exceeding the safety limit',
      );
    });
  });

  describe('normalize()', () => {
    const baseItem = {
      id: 19252,
      title: 'Fallback listing',
      deeplink: '/wohnungsfinder/fallback',
      rooms: '2,0',
      area: '51,04',
    };
    const normalize = (item, tuple = true) => runConfig.normalize({ id: listingSnapshot(item, tuple) });

    it('should support object snapshots and rent fallbacks', () => {
      const objectListing = normalize({ ...baseItem, rentGross: '503,91' }, false);
      const netRentListing = normalize({ ...baseItem, rentNet: '428,38' });

      expect(objectListing.price).toBe(503.91);
      expect(objectListing.link).toBe('https://inberlinwohnen.de/wohnungsfinder/fallback');
      expect(netRentListing.price).toBe(428.38);
      expect(netRentListing.id).toBe(objectListing.id);
    });

    it('should quote the cold rent when the listing publishes both', () => {
      // The affordability check adds the Nebenkosten surcharge to `price` itself, so a listing
      // carrying both figures has to hand over the Kaltmiete - quoting the Gesamtmiete counted the
      // Nebenkosten twice. The Gesamtmiete stays in the description, where it costs nothing.
      const listing = normalize({ ...baseItem, rentNet: '800', extraCosts: '183', rentGross: '983,08' });

      expect(listing.price).toBe(800);
      expect(listing.description).toContain('Kaltmiete: 800 €');
      expect(listing.description).toContain('Gesamtmiete: 983,08 €');
    });

    it('should reject links that do not point at the portal or a known partner', () => {
      expect(normalize({ ...baseItem, deeplink: 'http://%' }).link).toBeNull();
      expect(normalize({ ...baseItem, deeplink: 'javascript:alert(1)' }).link).toBeNull();
      expect(normalize({ ...baseItem, deeplink: 'https://example.com/listing/1' }).link).toBeNull();
    });

    it('should prefer the partner object id so ids survive portal side re-imports', () => {
      expect(normalize({ ...baseItem, id: 100, objectId: 'partner-42' }).id).toBe(buildHash('partner-42'));
    });
  });

  describe('filter()', () => {
    it('should apply blacklist terms to titles and descriptions', () => {
      runConfig = provider.createConfig(providerConfig.inberlinwohnen, ['wbs']);

      expect(runConfig.filter({ title: 'Wohnung mit WBS', description: '', link: 'https://howoge.de/1' })).toBe(false);
      expect(runConfig.filter({ title: 'Wohnung', description: 'WBS erforderlich', link: 'https://howoge.de/1' })).toBe(
        false,
      );
      expect(runConfig.filter({ title: 'Wohnung', description: 'Bezugsfertig', link: 'https://howoge.de/1' })).toBe(
        true,
      );
    });

    it('should leave WBM listings to the direct provider only when the source opts in', () => {
      const wbmListing = {
        title: 'Wohnung',
        description: 'Bezugsfertig',
        link: 'https://www.wbm.de/wohnungen-berlin/angebote/details/example/',
      };
      const directWbmConfig = provider.createConfig(
        { url: `${providerConfig.inberlinwohnen.url}?fredyDirectWbm=true`, enabled: true },
        [],
      );

      expect(runConfig.filter(wbmListing)).toBe(true);
      expect(directWbmConfig.url).not.toContain('fredyDirectWbm');
      expect(directWbmConfig.filter(wbmListing)).toBe(false);
      expect(
        directWbmConfig.filter({
          title: 'Wohnung',
          description: 'Bezugsfertig',
          link: 'https://www.howoge.de/immobiliensuche/detail/example/',
        }),
      ).toBe(true);
    });
  });

  describe('activityProbe()', () => {
    it('should follow safe redirects when checking if a listing is active', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: '/properties/new.html' }) })
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce({ status: 410 })
        .mockResolvedValueOnce({ status: 503 })
        .mockRejectedValueOnce(new Error('network failure'));
      globalThis.fetch = fetchMock;

      try {
        await expect(runConfig.activityProbe('https://www.degewo.de/redirect')).resolves.toBe(1);
        await expect(runConfig.activityProbe('https://www.degewo.de/gone')).resolves.toBe(0);
        await expect(runConfig.activityProbe('https://www.degewo.de/removed')).resolves.toBe(0);
        await expect(runConfig.activityProbe('https://www.degewo.de/unavailable')).resolves.toBe(-1);
        await expect(runConfig.activityProbe('https://www.degewo.de/network-error')).resolves.toBe(-1);
        // hosts outside of the portal and its partners must never be requested
        await expect(runConfig.activityProbe('http://127.0.0.1/private')).resolves.toBe(-1);

        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          'https://www.degewo.de/redirect',
          expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          'https://www.degewo.de/properties/new.html',
          expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
        );
        expect(fetchMock).toHaveBeenCalledTimes(6);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
