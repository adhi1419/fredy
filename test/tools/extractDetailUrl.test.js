/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { extractFirstDetailUrl } from '../../tools/testFixtures/extractDetailUrl.js';

/**
 * The three selector shapes that used to break the fixture downloader, exercised directly with
 * synthetic configs rather than through a shipped provider:
 *  - an attribute on the crawl container itself (`@href`)
 *  - an attribute whose name contains a dash (`.aditem@data-href`)
 *  - a selector that only resolves correctly when scoped to the crawl container (`a@href`)
 *
 * No shipped provider uses an HTML crawl container with a selector-derived detail link anymore
 * (the kept providers read JSON APIs, a Livewire snapshot, or their own parser), so this covers the
 * extractor logic the downloader relies on without importing a provider module.
 */
const LIST_URL = 'https://example.com/search';
const makeConfig = (overrides) => ({
  url: LIST_URL,
  normalize: (parsed) => ({ link: parsed.id }),
  ...overrides,
});

const cases = [
  {
    name: 'an attribute on the crawl container itself (@href)',
    html: '<a class="result" href="/listing/1">One</a><a class="result" href="/listing/2">Two</a>',
    config: makeConfig({ crawlContainer: 'a.result', crawlFields: { id: '@href' } }),
    expected: 'https://example.com/listing/1',
  },
  {
    name: 'a dashed attribute (.aditem@data-href)',
    html: '<li class="ad-listitem"><article class="aditem" data-href="/listing/42">Ad</article></li>',
    config: makeConfig({ crawlContainer: '.ad-listitem', crawlFields: { id: '.aditem@data-href' } }),
    expected: 'https://example.com/listing/42',
  },
  {
    name: 'a selector scoped to the crawl container (a@href)',
    html: '<li class="hit"><a href="/listing/7">Seven</a></li>',
    config: makeConfig({ crawlContainer: '.hit', crawlFields: { id: 'a@href' } }),
    expected: 'https://example.com/listing/7',
  },
];

describe('extractFirstDetailUrl', () => {
  for (const { name, html, config, expected } of cases) {
    it(`finds the detail url via ${name}`, () => {
      const detailUrl = extractFirstDetailUrl(html, config);

      expect(detailUrl).toBe(expected);
      expect(detailUrl).toMatch(/^https?:\/\//);
      expect(detailUrl).not.toBe(config.url);
    });
  }

  it('returns null when the crawl container matches nothing', () => {
    const config = makeConfig({ crawlContainer: '.aditem', crawlFields: { id: '.aditem@data-href' } });

    expect(extractFirstDetailUrl('<html><body>nothing here</body></html>', config)).toBeNull();
  });

  it('returns null for an incomplete provider config', () => {
    expect(extractFirstDetailUrl('<html></html>', {})).toBeNull();
    expect(extractFirstDetailUrl('', { crawlContainer: 'a', crawlFields: {} })).toBeNull();
  });
});
