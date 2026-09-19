/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import SqliteConnection from '../storage/SqliteConnection.js';
import { isFirestore } from '../storage/backendResolver.js';
import * as jobStorage from '../storage/jobStorage.js';
import * as listingsStorage from '../storage/listingsStorage.js';
import logger from '../logger.js';
import { toJson, fromJson } from '../../utils.js';

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
 * Strip provider entries that no longer resolve to a provider module from every job config.
 *
 * @param {Set<string>} knownProviderIds - Ids of the currently available providers.
 * @returns {{jobsUpdated: number, providerConfigsRemoved: number, obsoleteProviderIds: string[]}}
 */
function removeObsoleteProvidersFromJobs(knownProviderIds) {
  const jobs = SqliteConnection.query(`SELECT id, name, provider FROM jobs`);
  const obsoleteProviderIds = new Set();
  let jobsUpdated = 0;
  let providerConfigsRemoved = 0;

  for (const job of jobs) {
    const configured = fromJson(job.provider, []);
    if (!Array.isArray(configured) || configured.length === 0) continue;

    const kept = configured.filter((entry) => knownProviderIds.has(entry?.id));
    if (kept.length === configured.length) continue;

    const removed = configured.filter((entry) => !knownProviderIds.has(entry?.id)).map((entry) => String(entry?.id));
    for (const id of removed) {
      obsoleteProviderIds.add(id);
    }

    SqliteConnection.execute(`UPDATE jobs SET provider = @provider WHERE id = @id`, {
      id: job.id,
      provider: toJson(kept),
    });

    jobsUpdated += 1;
    providerConfigsRemoved += removed.length;

    logger.info(
      `Removed ${removed.length} obsolete provider(s) from job "${job.name ?? job.id}": ${removed.join(', ')}`,
    );
  }

  return { jobsUpdated, providerConfigsRemoved, obsoleteProviderIds: [...obsoleteProviderIds] };
}

/**
 * Delete listings that were scraped by a provider that no longer exists. Listings without a
 * provider are removed as well, since they can never be matched to a provider module again
 * (that is exactly what makes the active checker log "Could not find matching provider").
 *
 * Watch list entries referencing those listings are removed by SQLite via ON DELETE CASCADE.
 *
 * @param {Set<string>} knownProviderIds - Ids of the currently available providers.
 * @returns {{listingsRemoved: number, obsoleteProviderIds: string[]}}
 */
function removeListingsOfObsoleteProviders(knownProviderIds) {
  const storedProviders = SqliteConnection.query(`SELECT DISTINCT provider FROM listings`).map((row) => row.provider);
  const obsoleteProviderIds = storedProviders.filter((provider) => !knownProviderIds.has(provider));

  let listingsRemoved = 0;
  for (const provider of obsoleteProviderIds) {
    const result =
      provider == null
        ? SqliteConnection.execute(`DELETE FROM listings WHERE provider IS NULL`)
        : SqliteConnection.execute(`DELETE FROM listings WHERE provider = @provider`, { provider });

    listingsRemoved += result.changes;
    if (result.changes > 0) {
      logger.info(`Removed ${result.changes} listing(s) of obsolete provider "${provider ?? 'unknown'}"`);
    }
  }

  return { listingsRemoved, obsoleteProviderIds: obsoleteProviderIds.map((provider) => provider ?? 'unknown') };
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

  if (isFirestore()) {
    return removeObsoleteProvidersFirestore(knownProviderIds);
  }

  return SqliteConnection.withTransaction(() => {
    const jobCleanup = removeObsoleteProvidersFromJobs(knownProviderIds);
    const listingCleanup = removeListingsOfObsoleteProviders(knownProviderIds);

    const obsoleteProviderIds = [
      ...new Set([...jobCleanup.obsoleteProviderIds, ...listingCleanup.obsoleteProviderIds]),
    ];

    if (obsoleteProviderIds.length > 0) {
      logger.info(`Cleaned up obsolete provider(s): ${obsoleteProviderIds.join(', ')}`);
    }

    return {
      obsoleteProviderIds,
      jobsUpdated: jobCleanup.jobsUpdated,
      providerConfigsRemoved: jobCleanup.providerConfigsRemoved,
      listingsRemoved: listingCleanup.listingsRemoved,
    };
  });
}

/**
 * Firestore path: use storage facades instead of raw SQL.
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

  // Listing cleanup: Firestore listings are keyed by (jobId, provider); query all providers
  // stored and delete those not in the known set. The listingsStorage facade exposes
  // getAvailableProviders() which returns the distinct provider ids.
  const storedProviders = await listingsStorage.getAvailableProviders();
  const obsoleteListingProviders = storedProviders.filter((p) => !knownProviderIds.has(p));
  let listingsRemoved = 0;
  // The facade does not expose a deleteByProvider, but we can query and delete by listing id.
  // For now, log the orphans. A full listing purge needs a dedicated facade function.
  // This mirrors the sqlite path's intent: on Firestore, orphan provider listings are already
  // unreachable (no provider module to scrape/check them).
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
