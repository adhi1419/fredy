/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ListingDeletionPreference } from '../../../services/state/userSettingsState.js';

export interface ListingDeletionDraft {
  hardDelete: boolean;
  skipPrompt: boolean;
}

export function listingDeletionDraft(preference?: ListingDeletionPreference): ListingDeletionDraft {
  return {
    hardDelete: preference?.hardDelete === true,
    skipPrompt: preference?.skipPrompt === true,
  };
}

export function listingDeletionDraftChanged(draft: ListingDeletionDraft, stored?: ListingDeletionPreference): boolean {
  const current = listingDeletionDraft(stored);
  return draft.hardDelete !== current.hardDelete || draft.skipPrompt !== current.skipPrompt;
}

export function providerDetailsDraft(providers?: readonly string[]): string[] {
  return Array.isArray(providers) ? [...providers] : [];
}

export function providerDetailSettingsChanged(
  selected: readonly string[],
  filterEnabled: boolean,
  storedProviders?: readonly string[],
  storedFilter?: boolean,
): boolean {
  const stored = providerDetailsDraft(storedProviders);
  return (
    filterEnabled !== (storedFilter === true) ||
    selected.length !== stored.length ||
    selected.some((providerId) => !stored.includes(providerId))
  );
}
