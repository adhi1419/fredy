/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';

import { detectDealTypeFromUrl as backend, DEAL_TYPES as backendTypes } from '../../lib/services/dealType.js';
import { detectDealTypeFromUrl as frontend, DEAL_TYPES as frontendTypes } from '../../ui/src/services/jobs/dealType.js';

const URLS = [
  'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/koeln/wohnung-mieten',
  'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/duesseldorf/wohnung-kaufen',
  'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/duesseldorf/haus-mit-garage-kaufen',
  'https://www.kleinanzeigen.de/s-immobilien/k0c195',
  'https://www.kleinanzeigen.de/s-wohnung-mieten/koeln/c203l1875',
  'https://www.immowelt.de/suche/koeln/wohnungen/mieten',
  'https://www.immowelt.de/suche/koeln/wohnungen/kaufen',
  'https://www.wg-gesucht.de/wohnungen-in-Koeln.73.2.1.0.html',
  'https://schwarzesbrett.bremen.de/verkauf-und-angebote/mietobjekte',
  'https://example.com/current/parent/torrent',
  'https://example.com/verkauf-und-angebote/',
  'https://www.neubaukompass.de/eigentumswohnung-koeln/',
  'https://example.com/?marketingType=buy',
  'https://example.com/?search.typ=mieten',
  'https://example.com/wohnung%2Dmieten',
  'https://example.com/%E0%A4%A',
  'https://example.com/nothing-in-particular',
  '',
  '   ',
];

describe('deal type detection stays in sync between the frontend copy and lib/', () => {
  it('agrees on the constants', () => {
    expect(frontendTypes).toEqual(backendTypes);
  });

  it.each(URLS)('agrees on %s', (url: string) => {
    expect(frontend(url)).toBe(backend(url));
  });

  it.each([[null], [undefined], [42], [{}]])('agrees on the non-string %s', (value: unknown) => {
    expect(frontend(value)).toBe(backend(value));
  });

  it('actually classifies rather than answering null throughout', () => {
    expect(URLS.map(frontend).filter((type) => type != null).length).toBeGreaterThan(5);
    expect(frontend('https://www.immowelt.de/suche/koeln/wohnungen/mieten')).toBe('rent');
    expect(frontend('https://www.immowelt.de/suche/koeln/wohnungen/kaufen')).toBe('buy');
  });
});
