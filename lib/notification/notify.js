/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../services/logger.js';
import { getNotificationAdapters } from '../utils.js';
import { assertSendResolved } from './notificationSendOutcome.js';

/** Every integration in ./adapter, loaded through the shared, CWD-independent plugin loader. */
const adapter = await getNotificationAdapters();

if (adapter.length === 0) {
  throw new Error('Please specify at least one notification provider');
}

/**
 * @param {{id: string}} notificationAdapter
 * @returns {any|undefined}
 */
const findAdapter = (notificationAdapter) => {
  return adapter.find((a) => a.config?.id === notificationAdapter.id);
};

/**
 * Dispatch one batch of listings to every adapter the job has configured.
 *
 * @param {string} serviceName
 * @param {Object[]} newListings
 * @param {Array<{id: string}>} notificationConfig
 * @param {string} jobKey
 * @param {string} baseUrl
 * @returns {Promise<any>[]} One promise per adapter that was found.
 */
export const send = (serviceName, newListings, notificationConfig, jobKey, baseUrl) => {
  //this is not being used in tests, therefore adapter are always set
  return resolveAdapters(notificationConfig, jobKey).map((a) =>
    a.send({ serviceName, newListings, notificationConfig, jobKey, baseUrl }),
  );
};

/**
 * Send exactly one listing to exactly one configured channel, awaiting the adapter's own send.
 *
 * This is the seam the delivery ledger reserves against: one listing, one channel, one awaited
 * outcome, so success and failure are per-(listing, channel) rather than smeared across a fan-out.
 * The adapter still selects its own credentials the way it always has — by matching
 * `config.id === channel.id` — but the array it is handed contains only this one channel, so two
 * channels sharing an adapter type never cross-read each other's fields.
 *
 * It intentionally does not touch the ledger; reservation and settlement stay in the orchestrator,
 * which owns the transaction boundary. A throw propagates so the orchestrator can classify it — and
 * a resolved value is not trusted blindly: {@link assertSendResolved} inspects it and throws when it
 * proves failure (a rejected `allSettled` entry, a nested failure, or a non-2xx Response), so a
 * fan-out adapter that fulfils while a channel failed cannot be miscounted as sent.
 *
 * @param {Object} params
 * @param {string} params.serviceName
 * @param {Object} params.listing A single formatted listing.
 * @param {{id: string, name?: string, fields?: Object, configuredAdapterId?: string}} params.channel
 * @param {string} params.jobKey
 * @param {string} params.baseUrl
 * @returns {Promise<any>} Resolves when the adapter's send resolves AND the resolved value proves no
 *   failure; rejects when the adapter throws or its resolved value proves a failure.
 */
export const sendOneToChannel = async ({ serviceName, listing, channel, jobKey, baseUrl }) => {
  const found = findAdapter(channel);
  if (!found) {
    throw new Error(`Notification adapter '${channel?.id}' not found for job '${jobKey || ''}'`);
  }
  let result;
  try {
    result = await found.send({
      serviceName,
      newListings: [listing],
      notificationConfig: [channel],
      jobKey,
      baseUrl,
    });
  } catch {
    throw new Error('notification adapter rejected');
  }
  await assertSendResolved(result);
  return result;
};

/**
 * Resolve a job's configured adapter ids to adapter modules, warning about the ones that are gone.
 *
 * @param {Array<{id: string}>} notificationConfig
 * @param {string} jobKey
 * @returns {any[]}
 */
const resolveAdapters = (notificationConfig, jobKey) => {
  return notificationConfig
    .map((notificationAdapter) => {
      const found = findAdapter(notificationAdapter);
      if (!found) {
        logger.warn(`Notification adapter '${notificationAdapter.id}' not found for job '${jobKey || ''}'`);
      }
      return found;
    })
    .filter(Boolean);
};

/**
 * Turn a price change into something an adapter that only knows `send` can still render.
 *
 * Used for third-party adapters that predate price tracking. The change is folded into the title
 * because that is the one field every adapter is guaranteed to show; silently sending them a
 * listing that reads as brand new would be worse than sending nothing.
 *
 * @param {import('../utils/formatListing.js').FormattedPriceChange} change
 * @returns {Object}
 */
const toFallbackListing = (change) => ({
  ...change,
  title: `${change.changeHeadline}: ${change.oldPrice} -> ${change.newPrice} (${change.changePercent}) - ${change.title}`,
});

/**
 * Dispatch one batch of price changes to every adapter the job has configured.
 *
 * Adapters opt in by exporting `sendPriceChange`. One that does not gets the batch through its
 * regular `send` with the change folded into the title, so an adapter written before this feature
 * existed keeps working rather than silently dropping the notification.
 *
 * @param {string} serviceName
 * @param {import('../utils/formatListing.js').FormattedPriceChange[]} priceChanges
 * @param {Array<{id: string}>} notificationConfig
 * @param {string} jobKey
 * @param {string} baseUrl
 * @returns {Promise<any>[]} One promise per adapter that was found.
 */
export const sendPriceChange = (serviceName, priceChanges, notificationConfig, jobKey, baseUrl) => {
  return resolveAdapters(notificationConfig, jobKey).map((a) => {
    if (typeof a.sendPriceChange === 'function') {
      return a.sendPriceChange({ serviceName, priceChanges, notificationConfig, jobKey, baseUrl });
    }
    return a.send({
      serviceName,
      newListings: priceChanges.map(toFallbackListing),
      notificationConfig,
      jobKey,
      baseUrl,
    });
  });
};
