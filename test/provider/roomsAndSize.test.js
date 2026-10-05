/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../../lib/services/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { config as immoscoutConfig } from '../../lib/provider/immoscout.js';
import { config as kleinanzeigenConfig } from '../../lib/provider/kleinanzeigen.js';

/**
 * Regression tests for https://github.com/orangecoding/fredy/issues/380 - rooms and living space
 * showed up as "N/A" although the listing carried both.
 *
 * These read the checked-in fixtures directly instead of going through the offline test mode, so
 * they never touch the network in either test mode.
 */
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../testFixtures');

const readFixture = async (name) => readFile(path.join(FIXTURES_DIR, name), 'utf-8');

const SEARCH_URL = 'https://api.mobile.immobilienscout24.de/search/list?searchType=region';

let immoscoutList;
let immoscoutDetail;

beforeEach(async () => {
  immoscoutList = JSON.parse(await readFixture('immoscout_list.json'));
  immoscoutDetail = JSON.parse(await readFixture('immoscout_detail.json'));

  vi.stubGlobal('fetch', async (url) => {
    const body = String(url).includes('/expose/') ? immoscoutDetail : immoscoutList;
    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('immoscout rooms and size', () => {
  it('reads the room count the search list carries', async () => {
    const listings = await immoscoutConfig.getListings(SEARCH_URL);
    const normalized = listings.map((listing) => immoscoutConfig.normalize(listing));

    // The mobile API hands the figures over unlabelled; reading them by position dropped the room
    // count entirely, which is what the bug report saw as "N/A" on every single listing.
    expect(normalized.every((listing) => typeof listing.rooms === 'number')).toBe(true);
    expect(normalized[0]).toMatchObject({ price: 2300, size: 131, rooms: 2 });
  });

  it('identifies the figures by their unit, not by their position', async () => {
    // A listing without a room count - a plot, for instance - used to shift `size` into `price`.
    immoscoutList.resultListItems = [
      {
        type: 'EXPOSE_RESULT',
        item: {
          id: '1',
          title: 'Grundstück',
          attributes: [
            { label: '', value: '450.000 €' },
            { label: '', value: '820 m²' },
          ],
        },
      },
    ];

    const [listing] = await immoscoutConfig.getListings(SEARCH_URL);

    expect(immoscoutConfig.normalize(listing)).toMatchObject({ price: 450000, size: 820, rooms: null });
  });
});

describe('kleinanzeigen rooms and size', () => {
  it('still reads the figures off the search result tags', () => {
    const normalized = kleinanzeigenConfig.normalize({
      id: '1',
      title: 'Wohnung',
      price: '1.200 €',
      tags: '82,17 m² · 2 Zi.',
    });

    expect(normalized).toMatchObject({ size: 82.17, rooms: 2 });
  });

  it('copes with a tag line whose separator did not survive extraction', () => {
    // `<span>89 m²</span><span>2 Zi.</span>` collapses to this; splitting on the middle dot used to
    // report the living space as the room count.
    const normalized = kleinanzeigenConfig.normalize({
      id: '1',
      title: 'Wohnung',
      price: '1.200 €',
      tags: '89 m²2 Zi.',
    });

    expect(normalized).toMatchObject({ size: 89, rooms: 2 });
  });

  it('reports nothing when the search result has no tags', () => {
    const normalized = kleinanzeigenConfig.normalize({ id: '1', title: 'Wohnung', price: '1.200 €', tags: '' });

    expect(normalized).toMatchObject({ size: null, rooms: null });
  });
});
