/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  ACCOUNT_NAV,
  NAV_TREE,
  PRIMARY_NAV,
  navTreeFor,
  resolvePrimaryKey,
  routeKeysOf,
} from '../../ui/src/components/navigation/navModel.js';

interface LocaleData {
  [key: string]: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const locales: readonly LocaleData[] = ['en', 'de', 'tr'].map((locale) =>
  JSON.parse(fs.readFileSync(path.join(here, `../../ui/src/locales/${locale}.json`), 'utf-8')),
);

describe('two-tab shell navigation model', () => {
  it('exposes exactly Home and Saved Searches as primary destinations', () => {
    expect(PRIMARY_NAV.map(({ key }) => key)).toEqual(['home', 'saved-searches']);
    expect(PRIMARY_NAV.map(({ path }) => path)).toEqual(['/dashboard', '/jobs']);
  });

  it.each([
    ['/dashboard', 'home'],
    ['/listings', 'home'],
    ['/listings/listing/42', 'home'],
    ['/map', 'home'],
    ['/finance?dealType=buy', 'home'],
    ['/jobs', 'saved-searches'],
    ['/jobs/new', 'saved-searches'],
    ['/jobs/edit/abc-123', 'saved-searches'],
  ])('maps %s to %s without redirecting the deep link', (pathname, expected) => {
    expect(resolvePrimaryKey(pathname)).toBe(expected);
  });

  it('keeps settings and admin out of primary navigation', () => {
    expect(resolvePrimaryKey('/settings/preferences')).toBeNull();
    expect(resolvePrimaryKey('/admin/system')).toBeNull();
    expect(PRIMARY_NAV).toHaveLength(2);
  });

  it('exposes My account and conditionally Admin panel through the account control', () => {
    expect(ACCOUNT_NAV.map(({ key }) => key)).toEqual(['account', 'admin']);
    expect(routeKeysOf(navTreeFor(false))).toEqual(['/dashboard', '/jobs', '/settings']);
    expect(routeKeysOf(navTreeFor(true))).toEqual(['/dashboard', '/jobs', '/settings', '/admin']);
  });

  it('translates every visible shell label in all supported locales', () => {
    const keys: readonly string[] = [
      ...PRIMARY_NAV,
      ...ACCOUNT_NAV,
      { labelKey: 'nav.primary' },
      { labelKey: 'nav.account' },
    ].map(({ labelKey }) => labelKey);
    for (const locale of locales) {
      for (const key of keys) expect(locale[key]).toBeTruthy();
    }
  });

  it('keeps the compatibility tree limited to shell destinations', () => {
    expect(NAV_TREE.map(({ key }) => key)).toEqual(['/dashboard', '/jobs', 'account', 'admin']);
  });
});
