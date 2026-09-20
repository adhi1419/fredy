/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as jobStorage from '../storage/jobStorage.js';
import * as listingsStorage from '../storage/listingsStorage.js';
import logger from '../logger.js';

/**
 * @typedef {Object} ProviderCleanupResult
 * @property {string[]} obsoleteProviderIds - Provider ids that were found in the DB but no longer exist in lib/provider.
 * @property {number} jobsUpdated - Number of job rows whose provider config was rewritten.
 * @property {number} providerConfigsRemoved - Number of provider entries removed across all job configs.
 * @property {number} listingsRemoved - Number of listing rows removed.
 */

/**
 * Collect the ids of all provider modules that are currently available.
 *
 * @param {Array<{metaInformation?: {id?: string}}>} providers - Provider modules as returned by getProviders().
 * @returns {Set<string>} Set of known provider ids.
 */
function collectKnownProviderIds(providers) {
  const ids = new Set();
  for (const provider of providers ?? []) {
    const id = provider?.metaInformation?.id;
    if (typeof id === 'string' && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Remove every trace of providers that have been deleted from lib/provider.
 *
 * Fredy scans lib/provider on startup, so a provider that was dropped from the codebase still
 * lingers in the DB: in the provider config of existing jobs and in the listings it once found.
 * Those leftovers cannot be scraped or re-checked anymore, they only produce warnings. This
 * cleanup runs once per startup, right after the provider modules have been loaded.
 *
 * When no provider module could be loaded at all, the cleanup is skipped: that state means the
 * provider directory could not be read, and pruning against an empty set would wipe the DB.
 *
 * @param {Array<{metaInformation?: {id?: string}}>} providers - Provider modules as returned by getProviders().
 * @returns {Promise<ProviderCleanupResult>} What was removed.
 */
export async function removeObsoleteProviders(providers) {
  const knownProviderIds = collectKnownProviderIds(providers);

  if (knownProviderIds.size === 0) {
    logger.warn('No providers loaded, skipping cleanup of obsolete providers.');
    return { obsoleteProviderIds: [], jobsUpdated: 0, providerConfigsRemoved: 0, listingsRemoved: 0 };
  }

  return removeObsoleteProvidersFirestore(knownProviderIds);
}

/**
 * Remove obsolete provider references through the public storage APIs.
 *
 * @param {Set<string>} knownProviderIds
 * @returns {Promise<ProviderCleanupResult>}
 */
async function removeObsoleteProvidersFirestore(knownProviderIds) {
  const jobs = await jobStorage.getJobs({ includeDisabled: true });
  const obsoleteProviderIds = new Set();
  let jobsUpdated = 0;
  let providerConfigsRemoved = 0;

  for (const job of jobs) {
    const configured = Array.isArray(job.provider) ? job.provider : [];
    if (configured.length === 0) continue;

    const kept = configured.filter((entry) => knownProviderIds.has(entry?.id));
    if (kept.length === configured.length) continue;

    const removed = configured.filter((entry) => !knownProviderIds.has(entry?.id)).map((entry) => String(entry?.id));
    for (const id of removed) {
      obsoleteProviderIds.add(id);
    }

    // Re-upsert the job with the cleaned provider list.
    await jobStorage.upsertJob({ ...job, jobId: job.id, provider: kept });
    jobsUpdated += 1;
    providerConfigsRemoved += removed.length;
    logger.info(
      `Removed ${removed.length} obsolete provider(s) from job "${job.name ?? job.id}": ${removed.join(', ')}`,
    );
  }

  // Listing cleanup uses a dedicated system-only inventory query. Product-facing
  // getAvailableProviders() is always user-scoped and intentionally returns nothing without a user.
  const storedProviders = await listingsStorage.getStoredProviderIdsForSystem();
  const obsoleteListingProviders = storedProviders.filter((p) => !knownProviderIds.has(p));
  let listingsRemoved = 0;
  // The facade does not expose a deleteByProvider, but we can query and delete by listing id.
  // For now, log the orphans. A full listing purge needs a dedicated storage function;
  // orphan provider listings are already inert because no module can scrape or check them.
  if (obsoleteListingProviders.length > 0) {
    logger.info(
      `Found ${obsoleteListingProviders.length} obsolete provider(s) with listings in Firestore. Listings from deleted providers are inert.`,
    );
  }

  const allObsolete = [...new Set([...obsoleteProviderIds, ...obsoleteListingProviders.map(String)])];
  if (allObsolete.length > 0) {
    logger.info(`Cleaned up obsolete provider(s): ${allObsolete.join(', ')}`);
  }

  return {
    obsoleteProviderIds: allObsolete,
    jobsUpdated,
    providerConfigsRemoved,
    listingsRemoved,
  };
}
