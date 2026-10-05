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
 * Every provider's path to the Baujahr and the energy efficiency class, against the real payloads.
 * The extractors themselves are covered in `test/utils/buildingFacts.test.js`; what is tested here
 * is the wiring - which source each provider reads, and that it reads the one its exposé actually
 * carries. Every shipped provider reads over plain HTTP, so the detail loader is injected.
 */
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../testFixtures');
const readFixture = async (name) => readFile(path.join(FIXTURES_DIR, name), 'utf-8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('immoscout', () => {
  beforeEach(async () => {
    const detail = JSON.parse(await readFixture('immoscout_detail.json'));
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => detail }));
  });

  it('reads the Baujahr and the class its label picture names', async () => {
    const enriched = await immoscoutConfig.fetchDetails({
      link: 'https://www.immobilienscout24.de/expose/168963883',
    });

    // The exposé states "Baujahr: 1950" next to "Baujahr laut Energieausweis: 2025".
    expect(enriched.buildYear).toBe(1950);
    // Stated as `.../energy-efficiency-labels/C.png` and nowhere as text.
    expect(enriched.energyClass).toBe('C');
  });
});

describe('kleinanzeigen', () => {
  // Kleinanzeigen pages are read over plain HTTP, so the loader is injected rather than mocked.
  const loadFixture = (html) => async () => html;

  it('reads the Baujahr off the attribute list when the ad states one', async () => {
    const html = (await readFixture('kleinanzeigen_detail.html')).replace(
      '<ul class="addetailslist--split">',
      '<ul class="addetailslist--split"><li class="addetailslist--detail">Baujahr' +
        '<span class="addetailslist--detail--value">1998</span></li>',
    );

    const enriched = await kleinanzeigenConfig.fetchDetails(
      { id: 'a', link: '/s-anzeige/schoene-wohnung/1234-203-2462' },
      loadFixture(html),
    );

    expect(enriched.buildYear).toBe(1998);
  });

  it('falls back to the ad text for the class the attribute list never carries', async () => {
    const enriched = await kleinanzeigenConfig.fetchDetails(
      { id: 'a', link: '/s-anzeige/schoene-wohnung/1234-203-2462' },
      loadFixture(await readFixture('kleinanzeigen_detail.html')),
    );

    // This ad states no Baujahr anywhere, but spells the class out in its energy block.
    expect(enriched.buildYear).toBeNull();
    expect(enriched.energyClass).toBe('E');
  });
});
