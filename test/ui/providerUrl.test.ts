/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';

import {
  findProviderByUrl,
  getSafeProviderUrl,
  normalizeHost,
  validateProviderUrl,
} from '../../ui/src/services/jobs/providerUrl.js';
import type { ProviderMetadata, ProviderUrlProblem } from '../../ui/src/services/jobs/providerUrl.js';

const immoscout = {
  baseUrl: 'https://www.immobilienscout24.de/',
} satisfies ProviderMetadata;

type NormalizeHostCase = [url: string, expected: string];
const normalizeHostCases: NormalizeHostCase[] = [
  ['https://www.immobilienscout24.de/', 'immobilienscout24.de'],
  ['http://immobilienscout24.de/Suche', 'immobilienscout24.de'],
  ['www.immobilienscout24.de', 'immobilienscout24.de'],
  ['IMMOBILIENSCOUT24.DE', 'immobilienscout24.de'],
];

const nullHostCases: Array<[url: string | null | undefined]> = [[null], [undefined], [''], ['   '], ['http://']];

describe('normalizeHost', () => {
  it.each(normalizeHostCases)('reduces %s to its bare host', (url, expected) => {
    expect(normalizeHost(url)).toBe(expected);
  });

  it.each(nullHostCases)('answers null for %s', (url) => {
    expect(normalizeHost(url)).toBeNull();
  });

  it.each([
    'javascript://immobilienscout24.de/search',
    'ftp://immobilienscout24.de/search',
    'https://user:password@immobilienscout24.de/search',
  ])('rejects unsafe host input %s', (url) => {
    expect(normalizeHost(url)).toBeNull();
  });

  it('normalizes a spoofed subdomain to its host (not null, as normalizeHost is a generic parser)', () => {
    expect(normalizeHost('https://immobilienscout24.de.evil.example/search')).toBe('immobilienscout24.de.evil.example');
  });
});

describe('findProviderByUrl', () => {
  it('resolves a URL-only legacy source by normalized provider host', () => {
    const provider = findProviderByUrl('https://www.immobilienscout24.de/Suche/de/berlin', [
      { id: 'immoscout', baseUrl: 'https://immobilienscout24.de/' },
      { id: 'immowelt', baseUrl: 'https://www.immowelt.de/' },
    ]);

    expect(provider).toEqual({ id: 'immoscout', baseUrl: 'https://immobilienscout24.de/' });
  });

  it.each([
    'javascript://immobilienscout24.de/Suche/de/berlin',
    'ftp://immobilienscout24.de/Suche/de/berlin',
    'https://immobilienscout24.de.evil.example/Suche/de/berlin',
    'https://user:password@immobilienscout24.de/Suche/de/berlin',
  ])('does not resolve unsafe or spoofed URL-only identity %s', (url) => {
    expect(findProviderByUrl(url, [{ id: 'immoscout', baseUrl: 'https://immobilienscout24.de/' }])).toBeNull();
  });
});

describe('getSafeProviderUrl', () => {
  it('returns a canonical href only for a matching HTTP(S) search URL', () => {
    expect(getSafeProviderUrl('http://www.immobilienscout24.de/Suche/de/berlin', immoscout)).toBe(
      'http://www.immobilienscout24.de/Suche/de/berlin',
    );
    expect(getSafeProviderUrl('www.immobilienscout24.de/Suche/de/berlin', immoscout)).toBe(
      'https://www.immobilienscout24.de/Suche/de/berlin',
    );
  });

  it.each([
    'javascript://immobilienscout24.de/search',
    'ftp://immobilienscout24.de/search',
    'https://user:password@immobilienscout24.de/search',
    'https://immobilienscout24.de.evil.example/search',
  ])('returns no href for unsafe or mismatched URL %s', (url) => {
    expect(getSafeProviderUrl(url, immoscout)).toBeNull();
  });
});

describe('validateProviderUrl', () => {
  it('accepts a real search url', () => {
    const result = validateProviderUrl(
      'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/koeln/wohnung-mieten',
      immoscout,
    );
    expect(result).toMatchObject({ ok: true, problem: null, expectedHost: 'immobilienscout24.de' });
  });

  const acceptedSearchCases: Array<[what: string, url: string]> = [
    ['a query-only search', 'https://www.immobilienscout24.de/?price=-1200'],
    ['a fragment-only search', 'https://www.immobilienscout24.de/#/results'],
    ['a url typed without its protocol', 'www.immobilienscout24.de/Suche/de/koeln/wohnung-mieten'],
  ];

  it.each(acceptedSearchCases)('accepts %s', (_what, url) => {
    expect(validateProviderUrl(url, immoscout).ok).toBe(true);
  });

  const bareHostCases: Array<[url: string]> = [
    ['https://www.immobilienscout24.de/'],
    ['https://www.immobilienscout24.de'],
    ['https://immobilienscout24.de//'],
    ['immobilienscout24.de'],
  ];

  it.each(bareHostCases)('refuses the bare homepage %s', (url) => {
    // The old check passed these. They save cleanly, run on schedule, and find nothing - which
    // looks exactly like a working job that the portal has no results for.
    const result = validateProviderUrl(url, immoscout);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe('bareHost');
  });

  it('refuses a search on the wrong portal, and says which one was expected', () => {
    const result = validateProviderUrl('https://www.immowelt.de/suche/koeln/wohnungen/mieten', immoscout);
    expect(result).toMatchObject({ ok: false, problem: 'wrongHost', expectedHost: 'immobilienscout24.de' });
  });

  const refusalCases: Array<
    [what: string, url: string | null | undefined, provider: ProviderMetadata | null, problem: ProviderUrlProblem]
  > = [
    ['no provider picked', 'https://www.immobilienscout24.de/Suche/x', null, 'noProvider'],
    ['an empty url', '', immoscout, 'empty'],
    ['a whitespace url', '   ', immoscout, 'empty'],
    ['a missing url', null, immoscout, 'empty'],
    ['something that is not a url', 'not a url at all', immoscout, 'unparsable'],
    ['an unsupported javascript scheme', 'javascript://immobilienscout24.de/search', immoscout, 'unsupportedScheme'],
    ['an unsupported ftp scheme', 'ftp://immobilienscout24.de/search', immoscout, 'unsupportedScheme'],
    [
      'userinfo disguised as the expected host',
      'https://user:password@immobilienscout24.de/search',
      immoscout,
      'unparsable',
    ],
    ['a spoofed subdomain', 'https://immobilienscout24.de.evil.example/search', immoscout, 'wrongHost'],
  ];

  it.each(refusalCases)('refuses %s', (_what, url, provider, problem) => {
    const result = validateProviderUrl(url, provider);
    expect(result.ok).toBe(false);
    expect(result.problem).toBe(problem);
  });

  it('reports the expected host even when the input is wrong, so the message can name it', () => {
    expect(validateProviderUrl('', immoscout).expectedHost).toBe('immobilienscout24.de');
  });

  it('refuses a provider whose base url is unusable rather than accepting anything', () => {
    const broken: ProviderMetadata = { baseUrl: '' };
    expect(validateProviderUrl('https://anything.example/search', broken)).toMatchObject({
      ok: false,
      problem: 'wrongHost',
    });
  });
});
