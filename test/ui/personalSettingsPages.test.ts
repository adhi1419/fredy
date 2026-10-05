/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('personal settings page presentation boundary', () => {
  const preferences = read('ui/src/views/settings/pages/PreferencesPage.tsx');
  const styles = read('ui/src/views/settings/pages/PersonalSettingsPages.less');

  it('renders plain sections rather than SegmentPart or a wrapper component', () => {
    expect(preferences).not.toContain('SegmentPart');
    expect(preferences).not.toContain('CompactPanel');
    expect(preferences).toContain('<section');
  });

  it('saves theme and language the moment they change, with nothing left to batch', () => {
    expect(preferences).toContain('await actions.userSettings.setTheme(nextTheme)');
    expect(preferences).toContain('await actions.userSettings.setLanguage(value)');
    // The listing-deletion preference and the provider-details page are gone: lifecycle auto-archive
    // owns ageing listings, and nothing fetches detail pages any more.
    expect(preferences).not.toContain('listing_deletion_preference');
    expect(preferences).not.toContain('personalSettingsPage__saveRow');
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/ListingDetailsPage.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/personalSettingsDrafts.ts'))).toBe(false);
  });

  it('keeps mobile sections contained and save actions at least 44px', () => {
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('max-width: 100%');
    expect(styles).toMatch(/button\s*{[^}]*min-height:\s*44px/s);
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('removes the migrated JSX counterparts', () => {
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/PreferencesPage.jsx'))).toBe(false);
  });
});
