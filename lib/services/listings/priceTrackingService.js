/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as cheerio from 'cheerio';
import fetchHtml from '../extractor/httpExtractor.js';
import { extractField } from '../extractor/parser/parser.js';
import {
  getListingsDueForPriceCheck,
  markListingsPriceChecked,
  PRICE_CHECK_STALE_MS,
} from '../storage/listingsStorage.js';
import { getSettings } from '../storage/settingsStorage.js';
import { getProviders, mapLimit } from '../../utils.js';
import { extractNumber } from '../../utils/extract-number.js';
import { getThresholdPercent, notifyPriceChanges, recordPriceChange } from './priceHistoryService.js';
import logger from '../logger.js';

/** Marks history rows written by this lane, so a later lane can be told apart in the data. */
const SOURCE = 'priceProbe';

/**
 * Re-read the price of listings that are already stored, and record what changed.
 *
 * This is the expensive sibling of the alive-checker. That one asks a yes/no question; this one
 * needs the figure, which lives on the rendered detail page. Every provider Fredy ships serves that
 * page over plain HTTP (or answers the price through an API), so the price is read with a request
 * rather than a browser. The run is still bounded two ways - it does nothing at all unless the
 * operator turned it on, and it takes at most `limit` listings per run.
 *
 * @param {Object} [opts]
 * @param {number} [opts.concurrency=2] Pages fetched in parallel.
 * @param {number} [opts.limit] Max listings probed per run. Defaults to the configured setting.
 * @param {number} [opts.staleAfterMs] Re-probe listings not priced within this window.
 * @returns {Promise<void>}
 */
export default async function runPriceTracker(opts = {}) {
  const settings = await getSettings();
  if (!settings?.priceTrackingEnabled) {
    logger.debug('Price tracking is disabled. Skipping.');
    return;
  }

  const limit = opts.limit ?? resolvePositiveInt(settings.priceCheckLimitPerRun, 100);
  const staleAfterMs =
    opts.staleAfterMs ?? resolvePositiveInt(settings.priceCheckIntervalDays, 7) * 24 * 60 * 60 * 1000;
  const concurrency = opts.concurrency ?? 2;

  const listings = await getListingsDueForPriceCheck({ limit, staleAfterMs: staleAfterMs || PRICE_CHECK_STALE_MS });
  if (listings.length === 0) {
    logger.debug('No listings due for a price check.');
    return;
  }

  const providers = await getProviders();
  /** @type {Record<string, any>} */
  const providerById = Object.create(null);
  for (const provider of providers) {
    const id = provider?.metaInformation?.id;
    if (id) providerById[id] = provider;
  }

  // A provider without a priceTracking block is not an error - it simply has no price extractor
  // yet. Dropping those up front means an instance that uses only such providers does no work at
  // all.
  const trackable = listings.filter((listing) => providerById[listing.provider]?.config?.priceTracking != null);
  if (trackable.length === 0) {
    logger.debug(`None of the ${listings.length} due listings belong to a price-tracked provider.`);
    return;
  }

  const thresholdPercent = await getThresholdPercent();

  /** @type {string[]} Every listing we attempted, so none of them stays permanently due. */
  const attemptedIds = [];
  /** @type {import('../../utils/formatListing.js').PriceChange[]} */
  const changes = [];

  try {
    await mapLimit(trackable, concurrency, async (listing) => {
      const provider = providerById[listing.provider];
      attemptedIds.push(listing.id);

      const price = await readPrice(listing, provider);
      if (price == null) {
        logger.debug(`No price could be read for listing ${listing.id} (${listing.provider}).`);
        return;
      }

      const change = recordPriceChange(listing, price, { source: SOURCE, thresholdPercent });
      if (change != null) changes.push(change);
    });
  } catch (error) {
    logger.error('Price tracking run failed.', error);
  }

  if (attemptedIds.length > 0) await markListingsPriceChecked(attemptedIds);

  logger.info(
    `Price check looked at ${attemptedIds.length} of ${listings.length} due listings, ${changes.length} changed enough to report.`,
  );

  await notifyPriceChanges(changes);
}

/**
 * Render a listing's page and pull the price out of it.
 *
 * Returns null for every failure mode - bot wall, timeout, a page that rendered but has no price
 * where the provider expected one. That is deliberately indistinguishable to the caller: "we do not
 * know this listing's price right now" must never be recorded as a change, because a null read
 * treated as a number is a fabricated price drop to zero.
 *
 * @param {{id: string, link: string, provider: string}} listing
 * @param {any} provider The provider module.
 * @returns {Promise<number|null>}
 */
async function readPrice(listing, provider) {
  const priceTracking = provider.config.priceTracking;
  try {
    // Providers that reach their price through an API answer for themselves; no page is fetched.
    if (typeof priceTracking.probe === 'function') {
      return sanitizePrice(await priceTracking.probe(listing));
    }

    // Every shipped provider serves its detail page over plain HTTP, so the page is fetched with a
    // request rather than a rendered browser.
    const html = await fetchHtml(listing.link, { name: `price_${listing.provider}` });
    // fetchHtml answers null on bot detection and on navigation errors alike.
    if (!html) return null;

    const raw =
      typeof priceTracking.extract === 'function'
        ? priceTracking.extract(html, listing)
        : extractField(cheerio.load(html).root(), priceTracking.selector);

    return sanitizePrice(raw);
  } catch (error) {
    logger.debug(`Price probe threw for listing ${listing.id}`, error);
    return null;
  }
}

/**
 * Coerce whatever a provider handed back into a usable price, or null.
 *
 * Zero and negative values are rejected rather than stored: no listing costs nothing, so a zero is
 * always a parse that went wrong, and storing it would report a 100% drop to every user watching
 * that listing.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number|null}
 */
function sanitizePrice(raw) {
  if (raw == null) return null;
  const value = typeof raw === 'number' ? raw : extractNumber(String(raw));
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function resolvePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
