/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The user-settings domain state and effects used by the aggregate Zustand store.
 *
 * This module owns settings response mapping and every user-setting write. Finance summary is a
 * separate aggregate slice, so its refresh is injected as one narrow callback rather than making
 * this domain depend on the whole root store.
 */

export interface SettingsObject {
  [key: string]: unknown;
}

export interface HomeAddress {
  label?: string;
  address?: string;
  departure?: SettingsObject;
  mode?: string;
  coords?: { lat: number; lng: number } | null;
  [key: string]: unknown;
}

export interface ListingDeletionPreference {
  skipPrompt?: boolean;
  hardDelete?: boolean;
  [key: string]: unknown;
}

export interface UserSettings {
  home_addresses?: readonly HomeAddress[];
  finance_profile?: SettingsObject | null;
  provider_details?: readonly string[];
  transit_hover_popups?: boolean;
  blacklist_filter_on_provider_details?: boolean;
  listings_view_mode?: 'grid' | 'table';
  jobs_view_mode?: 'grid' | 'table';
  listing_deletion_preference?: ListingDeletionPreference;
  inquiry_profile?: SettingsObject;
  language?: string;
  theme?: 'dark' | 'light';
  [key: string]: unknown;
}

export interface UserSettingsState {
  settings: UserSettings;
  loaded: boolean;
  loadFailed: boolean;
}

export interface UserSettingsRootState {
  userSettings: UserSettingsState;
}

export interface UserSettingsResponse {
  status: number;
  json: unknown;
}

export interface UserSettingsTransport {
  get(url: string): Promise<UserSettingsResponse>;
  post(url: string, data: unknown): Promise<UserSettingsResponse>;
}

export interface UserSettingsStateSetter {
  (updater: (state: UserSettingsRootState) => Partial<UserSettingsRootState>): void;
}

export type FinanceSummaryRefresh = () => Promise<void>;

export interface SaveFinanceSectionParams {
  section: 'rent' | 'buy';
  profile: SettingsObject;
}

export interface SaveInquiryProfileOptions {
  validateCommon?: boolean;
}

export interface UserSettingsEffects {
  getUserSettings(): Promise<void>;
  setHomeAddresses(addresses: readonly HomeAddress[]): Promise<unknown>;
  saveFinanceSection(params: SaveFinanceSectionParams): Promise<unknown>;
  deleteFinanceSection(section: 'rent' | 'buy'): Promise<unknown>;
  setProviderDetails(providers: readonly string[]): Promise<void>;
  setTransitHoverPopups(enabled: boolean): Promise<void>;
  setBlacklistFilterOnProviderDetails(enabled: boolean): Promise<void>;
  setListingsViewMode(listingsViewMode: 'grid' | 'table'): Promise<void>;
  setJobsViewMode(jobsViewMode: 'grid' | 'table'): Promise<void>;
  setListingDeletionPreference(preference: ListingDeletionPreference): Promise<void>;
  saveInquiryProfile(profile: SettingsObject, options?: SaveInquiryProfileOptions): Promise<SettingsObject>;
  setLanguage(language: string): Promise<void>;
  setTheme(theme: 'dark' | 'light'): Promise<void>;
}

export function createUserSettingsState(): UserSettingsState {
  return { settings: {}, loaded: false, loadFailed: false };
}

export function createUserSettingsEffects(
  set: UserSettingsStateSetter,
  transport: UserSettingsTransport,
  refreshFinanceSummary: FinanceSummaryRefresh,
): UserSettingsEffects {
  return {
    async getUserSettings() {
      try {
        const response = await transport.get('/api/user/settings');
        set((state) => ({
          userSettings: {
            ...state.userSettings,
            settings: asUserSettings(response.json),
            loaded: true,
            loadFailed: false,
          },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/user/settings. Error:', exception);
        // Mark as loaded even on error to prevent blocking the UI.
        set((state) => ({
          userSettings: { ...state.userSettings, loaded: true, loadFailed: true },
        }));
      }
    },

    async setHomeAddresses(addresses) {
      try {
        const response = await transport.post('/api/user/settings/home-address', { home_addresses: addresses });
        if (response.status === 200) {
          const payload = asRecord(response.json);
          setSetting(set, 'home_addresses', payload.home_addresses);
          return response.json;
        }
        throw response;
      } catch (exception) {
        console.error('Error while trying to update addresses. Error:', exception);
        throw exception;
      }
    },

    async saveFinanceSection({ section, profile }) {
      return persistFinanceSection(set, transport, refreshFinanceSummary, { section, profile });
    },

    async deleteFinanceSection(section) {
      return persistFinanceSection(set, transport, refreshFinanceSummary, { section, remove: true });
    },

    async setProviderDetails(providers) {
      try {
        await transport.post('/api/user/settings/provider-details', { provider_details: providers });
        setSetting(set, 'provider_details', providers);
      } catch (exception) {
        console.error('Error while trying to update provider details setting. Error:', exception);
        throw exception;
      }
    },

    async setTransitHoverPopups(enabled) {
      try {
        await transport.post('/api/user/settings/transit-hover-popups', { transit_hover_popups: enabled });
        setSetting(set, 'transit_hover_popups', enabled);
      } catch (exception) {
        console.error('Error while trying to update the transit hover popups setting. Error:', exception);
        throw exception;
      }
    },

    async setBlacklistFilterOnProviderDetails(enabled) {
      try {
        await transport.post('/api/user/settings/blacklist-filter-on-details', {
          blacklist_filter_on_provider_details: enabled,
        });
        setSetting(set, 'blacklist_filter_on_provider_details', enabled);
      } catch (exception) {
        console.error('Error while trying to update blacklist-filter-on-provider-details setting. Error:', exception);
        throw exception;
      }
    },

    async setListingsViewMode(listingsViewMode) {
      try {
        await transport.post('/api/user/settings/listings-view-mode', { listings_view_mode: listingsViewMode });
        setSetting(set, 'listings_view_mode', listingsViewMode);
      } catch (exception) {
        console.error('Error while trying to update listings view mode setting. Error:', exception);
        throw exception;
      }
    },

    async setJobsViewMode(jobsViewMode) {
      try {
        await transport.post('/api/user/settings/jobs-view-mode', { jobs_view_mode: jobsViewMode });
        setSetting(set, 'jobs_view_mode', jobsViewMode);
      } catch (exception) {
        console.error('Error while trying to update jobs view mode setting. Error:', exception);
        throw exception;
      }
    },

    async setListingDeletionPreference(preference) {
      try {
        await transport.post('/api/user/settings/listing-deletion-preference', {
          listing_deletion_preference: preference,
        });
        setSetting(set, 'listing_deletion_preference', preference);
      } catch (exception) {
        console.error('Error while updating listing deletion preference. Error:', exception);
        throw exception;
      }
    },

    async saveInquiryProfile(profile, options = {}) {
      try {
        const payload = {
          inquiry_profile: profile,
          ...(options.validateCommon === true ? { validate_common: true } : {}),
        };
        const response = await transport.post('/api/user/settings/inquiry-profile', payload);
        if (response.status >= 400) throw response;
        const storedProfile = asRecord(response.json).inquiry_profile;
        const stored = asRecord(storedProfile);
        const nextProfile = Object.keys(stored).length > 0 ? stored : profile;
        setSetting(set, 'inquiry_profile', nextProfile);
        return nextProfile;
      } catch (exception) {
        console.error('Error while trying to save inquiry profile. Error:', exception);
        throw exception;
      }
    },

    async setLanguage(language) {
      try {
        await transport.post('/api/user/settings/language', { language });
        setSetting(set, 'language', language);
      } catch (exception) {
        console.error('Error while trying to update language setting. Error:', exception);
        throw exception;
      }
    },

    async setTheme(theme) {
      try {
        await transport.post('/api/user/settings/theme', { theme });
        setSetting(set, 'theme', theme);
      } catch (exception) {
        console.error('Error while trying to update theme setting. Error:', exception);
        throw exception;
      }
    },
  };
}

async function persistFinanceSection(
  set: UserSettingsStateSetter,
  transport: UserSettingsTransport,
  refreshFinanceSummary: FinanceSummaryRefresh,
  payload: { section: 'rent' | 'buy'; profile?: SettingsObject; remove?: boolean },
): Promise<unknown> {
  try {
    const response = await transport.post('/api/user/settings/finance-profile/section', payload);
    const stored = asRecord(response.json).finance_profile;
    setSetting(set, 'finance_profile', stored);
    await refreshFinanceSummary();
    return stored;
  } catch (exception) {
    console.error('Error while trying to persist a finance profile section. Error:', exception);
    throw exception;
  }
}

function setSetting(set: UserSettingsStateSetter, key: string, value: unknown): void {
  set((state) => ({
    userSettings: {
      ...state.userSettings,
      settings: { ...state.userSettings.settings, [key]: value },
    },
  }));
}

function asUserSettings(value: unknown): UserSettings {
  return asRecord(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
