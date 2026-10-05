/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { config, pageUrl, parseSearchResults } from '../../lib/provider/kleinanzeigen.js';

const fixture = await readFile(new URL('../testFixtures/kleinanzeigen.html', import.meta.url), 'utf-8');

/** One result card in the markup Kleinanzeigen serves, utility classes left out. */
const card = ({ id, description, tags = '90 m² · 3 Zi.', price = '1.400 €', struck = null }) => `
  <li><article data-adid="${id}" data-href="/s-anzeige/wohnung/${id}-203-1">
    <img src="https://img.example/${id}.jpg">
    <div><svg data-title="locationOutline"></svg><span>10247 Friedrichshain</span></div>
    <h3><a href="/s-anzeige/wohnung/${id}-203-1">Wohnung ${id}</a></h3>
    <p>${description}</p>
    <p>${tags}</p>
    <div><p>${price}</p>${struck ? `<p class="line-through">${struck}</p>` : ''}</div>
  </article></li>`;
const page = (cards) => `<html><body><h1>Ergebnisse</h1><ul id="srchrslt-adtable">${cards.join('')}</ul></body></html>`;

describe('kleinanzeigen search results', () => {
  it('reads every result of the fixture with all list fields', () => {
    const listings = parseSearchResults(fixture).map(config.normalize);

    expect(listings.length).toBeGreaterThan(20);
    for (const listing of listings) {
      expect(listing).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        price: expect.any(Number),
        address: expect.any(String),
      });
      expect(listing.link).toMatch(/^https:\/\/www\.kleinanzeigen\.de\/s-anzeige\//);
    }
  });

  it('never mistakes a description naming a size or a rent for the tag line or the price', () => {
    const [listing] = parseSearchResults(
      page([card({ id: '1', description: 'Schöne 96-m²-Wohnung, Warmmiete 2.270 €.' })]),
    ).map(config.normalize);

    expect(listing).toMatchObject({ size: 90, rooms: 3, price: 1400, address: '10247 Friedrichshain' });
  });

  it('reads the current price, not the struck-through former one', () => {
    const [listing] = parseSearchResults(
      page([card({ id: '1', description: 'Hell', price: '1.400 €', struck: '1.500 €' })]),
    ).map(config.normalize);

    expect(listing.price).toBe(1400);
  });

  it('answers an empty list for a search without results', () => {
    expect(parseSearchResults('<html><h1>Es wurden keine Ergebnisse in Berlin gefunden.</h1></html>')).toEqual([]);
  });

  it('fails loudly on a page that is not a result list, instead of reporting no listings', () => {
    expect(() => parseSearchResults('<html><h1>Wartungsarbeiten</h1></html>')).toThrow(/not a search result list/);
  });

  it('fetches the search page over HTTP and fails when it cannot be loaded', async () => {
    const urls = [];
    const listings = await config.getListings('https://www.kleinanzeigen.de/s-x', async (url) => {
      urls.push(url);
      return page([card({ id: '7', description: 'Hell' })]);
    });
    expect(urls).toEqual(['https://www.kleinanzeigen.de/s-x']);
    expect(listings).toHaveLength(1);

    await expect(config.getListings('https://www.kleinanzeigen.de/s-x', async () => null)).rejects.toThrow(
      'could not be loaded',
    );
  });

  it('builds page URLs the way Kleinanzeigen links them', () => {
    const url = 'https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/preis::1000/c203l3331+wohnung_mieten.qm_d:55.00';
    expect(pageUrl(url, 1)).toBe(url);
    expect(pageUrl(url, 3)).toBe(
      'https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/preis::1000/seite:3/c203l3331+wohnung_mieten.qm_d:55.00',
    );
    // An existing page segment is replaced, not stacked.
    expect(pageUrl(pageUrl(url, 2), 4)).toBe(pageUrl(url, 4));
    expect(pageUrl('https://www.kleinanzeigen.de/s-immobilien/duesseldorf/k0c195l2068r5', 2)).toBe(
      'https://www.kleinanzeigen.de/s-immobilien/duesseldorf/seite:2/k0c195l2068r5',
    );
  });

  it('walks every page until the reported total is covered, keeping each result once', async () => {
    const heading = (total) => `<h1>1 - 25 von ${total} Ergebnissen in Berlin</h1>`;
    const pageOf = (total, ids) =>
      page(ids.map((id) => card({ id: String(id), description: 'Hell' }))).replace(
        '<h1>Ergebnisse</h1>',
        heading(total),
      );
    const pages = {
      1: pageOf(5, [1, 2]),
      2: pageOf(5, [2, 3, 4]), // the list shifted while it was walked: 2 shows up again
      3: pageOf(5, [5]),
    };
    const asked = [];
    const listings = await config.getListings('https://www.kleinanzeigen.de/s-x/c203l3331', async (url) => {
      const number = Number(/seite:(\d+)/.exec(url)?.[1] ?? 1);
      asked.push(number);
      return pages[number] ?? null;
    });

    expect(asked).toEqual([1, 2, 3]);
    expect(listings.map((listing) => listing.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('retries a challenged later page and returns the complete result set', async () => {
    const first = page([card({ id: '1', description: 'Hell' })]).replace(
      '<h1>Ergebnisse</h1>',
      '<h1>1 - 25 von 3 Ergebnissen</h1>',
    );
    const second = page([card({ id: '2', description: 'Hell' }), card({ id: '3', description: 'Hell' })]);
    const asked = [];
    const loadPage = vi.fn(async (url) => {
      const pageNumber = Number(/seite:(\d+)/.exec(url)?.[1] ?? 1);
      asked.push(pageNumber);
      if (pageNumber === 1) return first;
      return asked.filter((page) => page === 2).length === 1
        ? '<html><h1>Finden Sie Ihr neues Zuhause</h1></html>'
        : second;
    });

    const listings = await config.getListings('https://www.kleinanzeigen.de/s-x/c203l3331', loadPage);

    expect(asked).toEqual([1, 2, 2]);
    expect(listings.map((listing) => listing.id)).toEqual(['1', '2', '3']);
    expect(loadPage.mock.calls[2][1]).toMatchObject({
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
  });

  it('fails after retrying a later page instead of returning a partial result', async () => {
    const first = page([card({ id: '1', description: 'Hell' })]).replace(
      '<h1>Ergebnisse</h1>',
      '<h1>1 - 25 von 60 Ergebnissen</h1>',
    );
    const loadPage = vi.fn(async (url) => (url.includes('seite:') ? null : first));

    await expect(config.getListings('https://www.kleinanzeigen.de/s-x/c203l3331', loadPage)).rejects.toThrow(
      'page 2 could not be loaded',
    );
    expect(loadPage).toHaveBeenCalledTimes(3);
  });
});
