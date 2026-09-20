/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  listingDeletionDraft,
  listingDeletionDraftChanged,
  providerDetailsDraft,
  providerDetailSettingsChanged,
} from '../../ui/src/views/settings/pages/personalSettingsDrafts.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('personal settings drafts', () => {
  it('normalizes deletion defaults and detects only unsaved deletion changes', () => {
    expect(listingDeletionDraft(undefined)).toEqual({ hardDelete: false, skipPrompt: false });
    expect(listingDeletionDraft({ hardDelete: true, skipPrompt: true })).toEqual({
      hardDelete: true,
      skipPrompt: true,
    });
    expect(
      listingDeletionDraftChanged({ hardDelete: false, skipPrompt: false }, { hardDelete: false, skipPrompt: false }),
    ).toBe(false);
    expect(
      listingDeletionDraftChanged({ hardDelete: true, skipPrompt: false }, { hardDelete: false, skipPrompt: false }),
    ).toBe(true);
  });

  it('copies provider state and preserves the existing order-insensitive dirty contract', () => {
    const stored = ['immoscout', 'immowelt'];
    const draft = providerDetailsDraft(stored);
    expect(draft).toEqual(stored);
    expect(draft).not.toBe(stored);
    expect(providerDetailSettingsChanged(['immowelt', 'immoscout'], false, stored, false)).toBe(false);
    expect(providerDetailSettingsChanged(['immoscout'], false, stored, false)).toBe(true);
    expect(providerDetailSettingsChanged(stored, true, stored, false)).toBe(true);
  });
});

describe('personal settings page presentation boundary', () => {
  const preferences = read('ui/src/views/settings/pages/PreferencesPage.tsx');
  const listingDetails = read('ui/src/views/settings/pages/ListingDetailsPage.tsx');
  const styles = read('ui/src/views/settings/pages/PersonalSettingsPages.less');

  it('deletes SegmentPart from both migrated pages without replacing it with a wrapper component', () => {
    expect(preferences).not.toContain('SegmentPart');
    expect(listingDetails).not.toContain('SegmentPart');
    expect(preferences).not.toContain('CompactPanel');
    expect(listingDetails).not.toContain('CompactPanel');
    expect(preferences).toContain('<section');
    expect(listingDetails).toContain('<section');
  });

  it('keeps theme and language instant while deletion and provider settings stay batched', () => {
    expect(preferences).toContain('await actions.userSettings.setTheme(nextTheme)');
    expect(preferences).toContain('await actions.userSettings.setLanguage(value)');
    expect(preferences).toContain('await actions.userSettings.setListingDeletionPreference(deletionDraft)');
    expect(listingDetails).toContain('await actions.userSettings.setProviderDetails(selected)');
    expect(listingDetails).toContain('await actions.userSettings.setBlacklistFilterOnProviderDetails(filterEnabled)');
  });

  it('keeps mobile sections contained and save actions at least 44px', () => {
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('max-width: 100%');
    expect(styles).toMatch(/button\s*{[^}]*min-height:\s*44px/s);
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('removes the migrated JSX counterparts', () => {
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/PreferencesPage.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/ListingDetailsPage.jsx'))).toBe(false);
  });
});
