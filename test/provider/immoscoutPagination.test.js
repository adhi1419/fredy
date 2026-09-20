/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../lib/provider/immoscout.js';

/**
 * Build one mobile-API `/search/list` page. `page`/`numberOfPages` drive the walk's stop
 * condition; each item id is unique per page so the collected result proves every page was read.
 */
function page(pageNumber, numberOfPages, count) {
  const resultListItems = Array.from({ length: count }, (_, i) => ({
    type: 'EXPOSE_RESULT',
    item: {
      id: `p${pageNumber}-${i}`,
      title: `Listing ${pageNumber}-${i}`,
      attributes: [{ value: '1.000 €' }, { value: '60 m²' }, { value: '2 Zi.' }],
      titlePicture: { full: 'https://img/x.jpg' },
      address: { line: 'Somewhere' },
    },
  }));
  return { totalResults: numberOfPages * count, pageSize: count, pageNumber, numberOfPages, resultListItems };
}

const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) });

const BASE_URL = 'https://api.mobile.immobilienscout24.de/search/list?searchType=region&realestatetype=apartmentrent';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('immoscout getListings pagination', () => {
  it('walks every page and stops at numberOfPages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(page(1, 3, 50)))
      .mockResolvedValueOnce(ok(page(2, 3, 50)))
      .mockResolvedValueOnce(ok(page(3, 3, 10)));
    vi.stubGlobal('fetch', fetchMock);

    const listings = await config.getListings(BASE_URL);

    // 50 + 50 + 10, and no request for a fourth page.
    expect(listings).toHaveLength(110);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // pagenumber is set as Fredy's own cursor on each request.
    const pages = fetchMock.mock.calls.map((c) => new URL(c[0]).searchParams.get('pagenumber'));
    expect(pages).toEqual(['1', '2', '3']);
    // Listings from later pages are present, not just page one.
    expect(listings.some((l) => l.link.endsWith('/p3-0'))).toBe(true);
  });

  it('does not page past a single-page result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok(page(1, 1, 12)));
    vi.stubGlobal('fetch', fetchMock);

    const listings = await config.getListings(BASE_URL);

    expect(listings).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps earlier pages when a later page fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(page(1, 5, 50)))
      .mockResolvedValueOnce({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed',
        text: () => Promise.resolve('nope'),
      });
    vi.stubGlobal('fetch', fetchMock);

    const listings = await config.getListings(BASE_URL);

    // Page one survives; the failed page two ends the walk rather than throwing the run away.
    expect(listings).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops when the response omits the page count rather than spinning to the cap', async () => {
    const body = page(1, 3, 50);
    delete body.numberOfPages;
    const fetchMock = vi.fn().mockResolvedValue(ok(body));
    vi.stubGlobal('fetch', fetchMock);

    const listings = await config.getListings(BASE_URL);

    expect(listings).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
