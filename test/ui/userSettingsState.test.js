/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

import { createUserSettingsEffects, createUserSettingsState } from '../../ui/src/services/state/userSettingsState.js';

function setup() {
  const state = { userSettings: createUserSettingsState() };
  const get = vi.fn();
  const post = vi.fn();
  const refreshFinanceSummary = vi.fn().mockResolvedValue(undefined);
  const set = (updater) => Object.assign(state, updater(state));
  const effects = createUserSettingsEffects(set, { get, post }, refreshFinanceSummary);
  return { state, get, post, refreshFinanceSummary, effects };
}

describe('user settings state domain', () => {
  it('starts with the aggregate store settings shape', () => {
    expect(createUserSettingsState()).toEqual({ settings: {}, loaded: false });
  });

  it('maps the settings response and marks it loaded', async () => {
    const { state, get, effects } = setup();
    const settings = { language: 'de', theme: 'light', home_addresses: [] };
    get.mockResolvedValue({ status: 200, json: settings });

    await effects.getUserSettings();

    expect(get).toHaveBeenCalledWith('/api/user/settings');
    expect(state.userSettings).toEqual({ settings, loaded: true });
  });

  it('marks settings loaded when the initial request fails', async () => {
    const { state, get, effects } = setup();
    get.mockRejectedValue(new Error('offline'));

    await effects.getUserSettings();

    expect(state.userSettings).toEqual({ settings: {}, loaded: true });
  });

  it('preserves valid write payloads and local response mapping', async () => {
    const { state, post, effects } = setup();
    const addresses = [{ label: 'Work', address: 'Main Street 1', departure: { time: '08:00' }, mode: 'transit' }];
    const homeAddressResponse = {
      success: true,
      home_addresses: [...addresses, { ...addresses[0], coords: { lat: 52.5, lng: 13.4 } }],
    };
    post.mockResolvedValueOnce({ status: 200, json: homeAddressResponse });
    post.mockResolvedValue({ status: 200, json: { success: true } });

    await effects.setHomeAddresses(addresses);
    await effects.setProviderDetails(['immoscout']);
    await effects.setTransitHoverPopups(true);
    await effects.setBlacklistFilterOnProviderDetails(false);
    await effects.setListingsViewMode('table');
    await effects.setJobsViewMode('grid');
    await effects.setListingDeletionPreference({ skipPrompt: true, hardDelete: false });
    await effects.saveInquiryProfile({ name: 'Alice Example', immoscoutPrivacyAccepted: true });
    await effects.setLanguage('de');
    await effects.setTheme('light');

    expect(post.mock.calls).toEqual([
      ['/api/user/settings/home-address', { home_addresses: addresses }],
      ['/api/user/settings/provider-details', { provider_details: ['immoscout'] }],
      ['/api/user/settings/transit-hover-popups', { transit_hover_popups: true }],
      ['/api/user/settings/blacklist-filter-on-details', { blacklist_filter_on_provider_details: false }],
      ['/api/user/settings/listings-view-mode', { listings_view_mode: 'table' }],
      ['/api/user/settings/jobs-view-mode', { jobs_view_mode: 'grid' }],
      [
        '/api/user/settings/listing-deletion-preference',
        {
          listing_deletion_preference: { skipPrompt: true, hardDelete: false },
        },
      ],
      [
        '/api/user/settings/inquiry-profile',
        { inquiry_profile: { name: 'Alice Example', immoscoutPrivacyAccepted: true } },
      ],
      ['/api/user/settings/language', { language: 'de' }],
      ['/api/user/settings/theme', { theme: 'light' }],
    ]);
    expect(state.userSettings.settings).toMatchObject({
      home_addresses: homeAddressResponse.home_addresses,
      provider_details: ['immoscout'],
      transit_hover_popups: true,
      blacklist_filter_on_provider_details: false,
      listings_view_mode: 'table',
      jobs_view_mode: 'grid',
      listing_deletion_preference: { skipPrompt: true, hardDelete: false },
      inquiry_profile: { name: 'Alice Example', immoscoutPrivacyAccepted: true },
      language: 'de',
      theme: 'light',
    });
  });

  it('keeps finance section writes server-merged and refreshes the finance summary', async () => {
    const { state, post, refreshFinanceSummary, effects } = setup();
    const stored = { household: { adults: 2 }, renting: { monthlyRent: 1200 } };
    post.mockResolvedValue({ status: 200, json: { success: true, finance_profile: stored } });

    await expect(
      effects.saveFinanceSection({ section: 'rent', profile: { renting: { monthlyRent: 1200 } } }),
    ).resolves.toBe(stored);
    await expect(effects.deleteFinanceSection('buy')).resolves.toBe(stored);

    expect(post.mock.calls).toEqual([
      [
        '/api/user/settings/finance-profile/section',
        {
          section: 'rent',
          profile: { renting: { monthlyRent: 1200 } },
        },
      ],
      ['/api/user/settings/finance-profile/section', { section: 'buy', remove: true }],
    ]);
    expect(refreshFinanceSummary).toHaveBeenCalledTimes(2);
    expect(state.userSettings.settings.finance_profile).toBe(stored);
  });
});
