/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import * as provider from '../../lib/provider/wbm.js';
import { buildHash } from '../../lib/utils.js';

const SEARCH_URL = 'https://www.wbm.de/wohnungen-berlin/angebote/';
const detailUrl = (id) => `${SEARCH_URL}details/listing-${id}/`;
const searchPage = (ids) =>
  ids
    .flatMap((id) => [
      `<a class="immo-button-cta" href="/wohnungen-berlin/angebote/details/listing-${id}/">Ansehen</a>`,
      `<a href="/wohnungen-berlin/angebote/details/listing-${id}/">Zum Exposé</a>`,
    ])
    .join('');

const detailPage = (id, { coldRent = '524,71', size = '63.18', rooms = '2' } = {}) => `
  <html><head><meta property="og:image" content="/images/${id}.jpg"></head><body>
    <h1 class="openimmo-detail__title">Wohnung ${id}</h1>
    <p class="openimmo-detail__intro-address">Street ${id}, 10115 Berlin</p>
    <div class="openimmo-detail__intro-text">Helle Wohnung ${id}</div>
    <ul>
      <li class="openimmo-detail__rental-costs-list-item">
        <span class="openimmo-detail__rental-costs-list-item-title">Nettokaltmiete</span>
        <span class="openimmo-detail__rental-costs-list-item-value">${coldRent} EUR</span>
      </li>
      <li class="openimmo-detail__object-list-item"><span>Anzahl der Zimmer:</span> ${rooms}</li>
      <li class="openimmo-detail__object-list-item"><span>Größe:</span> ca. ${size} m²</li>
      <li class="openimmo-detail__object-list-item"><span>Objektnummer:</span> object-${id}</li>
    </ul>
    <form class="powermail_form"><input id="powermail_field_objekt" value="object-${id}"></form>
  </body></html>`;

describe('WBM provider', () => {
  it('deduplicates index links and parses cold-rent detail fields', async () => {
    const loadPage = vi.fn(async (url) =>
      url === SEARCH_URL ? searchPage([1, 2]) : detailPage(url.includes('1') ? 1 : 2),
    );
    const config = provider.createConfig({ url: SEARCH_URL, enabled: true }, []);

    const rows = await config.getListings(SEARCH_URL, loadPage);
    const listings = rows.map(config.normalize);

    expect(rows).toHaveLength(2);
    expect(loadPage).toHaveBeenCalledTimes(3);
    expect(listings[0]).toMatchObject({
      id: buildHash('object-1'),
      link: detailUrl(1),
      title: 'Wohnung 1',
      price: 524.71,
      size: 63.18,
      rooms: 2,
      address: 'Street 1, 10115 Berlin',
      image: 'https://www.wbm.de/images/1.jpg',
      description: 'Helle Wohnung 1',
    });
  });

  it('limits detail requests to three and skips a listing withdrawn during the crawl', async () => {
    let active = 0;
    let peak = 0;
    const loadPage = vi.fn(async (url) => {
      if (url === SEARCH_URL) return searchPage([1, 2, 3, 4, 5]);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return url === detailUrl(3)
        ? '<html><body>Offer removed</body></html>'
        : detailPage(url.match(/listing-(\d+)/)[1]);
    });

    const rows = await provider.config.getListings(SEARCH_URL, loadPage);

    expect(rows).toHaveLength(4);
    expect(peak).toBe(3);
  });

  it('fails loudly when the index or every detail page is unreadable', async () => {
    await expect(provider.config.getListings(SEARCH_URL, vi.fn().mockResolvedValue(null))).rejects.toThrow(
      'offer index could not be loaded',
    );
    const onlyIndex = vi
      .fn()
      .mockResolvedValueOnce(searchPage([1]))
      .mockResolvedValueOnce(null);
    await expect(provider.config.getListings(SEARCH_URL, onlyIndex)).rejects.toThrow(
      'detail pages could not be loaded',
    );
  });

  it('applies blockwords and always uses the canonical WBM index', () => {
    const config = provider.createConfig({ url: 'https://example.invalid/', enabled: true }, ['senior']);

    expect(config.url).toBe(SEARCH_URL);
    expect(config.filter({ title: 'Seniorenwohnung', description: '' })).toBe(false);
    expect(config.filter({ title: 'Wohnung', description: 'Helle Räume' })).toBe(true);
  });

  it('treats redirects as withdrawn and validates a direct detail response', async () => {
    const activeFetch = vi.fn().mockResolvedValue({ status: 200, text: async () => detailPage(1) });
    const redirectFetch = vi.fn().mockResolvedValue({
      status: 303,
      headers: new Headers({ location: SEARCH_URL }),
      text: async () => '',
    });

    await expect(provider.isListingActive(detailUrl(1), activeFetch)).resolves.toBe(1);
    await expect(provider.isListingActive(detailUrl(1), redirectFetch)).resolves.toBe(0);
    await expect(provider.isListingActive('http://127.0.0.1/private', activeFetch)).resolves.toBe(-1);
    expect(activeFetch).toHaveBeenCalledWith(
      detailUrl(1),
      expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }),
    );
  });
});
