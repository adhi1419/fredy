/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * notificationDeliveryPlanner — the pure half of the per-listing/per-channel notification ledger.
 *
 * It owns two decisions and nothing else: which (listing, channel) pairs a run intends to notify,
 * and whether a listing's aggregate notification is complete given the per-channel outcomes. It
 * performs no I/O, reserves nothing, and sends nothing, so every rule here is testable in isolation
 * and the orchestration layer stays a thin wiring of planner + storage + adapter.
 */

import { deliveryDocId, INITIAL_LISTING_NOTIFICATION_EVENT_KEY } from '../services/storage/firestore/collections.js';

/**
 * @typedef {Object} DeliveryTarget
 * @property {string} listingId The listing being notified about.
 * @property {string} configuredAdapterId The channel row id — the ledger's per-channel identity.
 * @property {string} adapterId The adapter type (telegram, slack, …) that will actually send.
 * @property {string} eventKey The logical notification event this target belongs to.
 * @property {string} deliveryId Deterministic ledger document id for this exact tuple.
 * @property {string[]} intendedConfiguredAdapterIds Sorted snapshot of every channel this run
 *   intends for this listing+event — durable repair evidence stored on the ledger record.
 * @property {number} intendedChannelCount Size of that intended set.
 */

/**
 * Normalise a job's hydrated notification config into the distinct channels a run should target.
 *
 * The hydrated shape is `{ id: adapterId, name, fields, configuredAdapterId }`. Only entries
 * carrying a real `configuredAdapterId` can be reserved per-channel, so anything without one is
 * dropped rather than guessed at. Duplicate references to the same channel collapse to one, because
 * a channel is notified at most once per listing per event.
 *
 * @param {Array<{id?: string, configuredAdapterId?: string}>|null|undefined} notificationConfig
 * @returns {Array<{configuredAdapterId: string, adapterId: string}>}
 */
export function resolveChannels(notificationConfig) {
  if (!Array.isArray(notificationConfig)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of notificationConfig) {
    const configuredAdapterId = entry?.configuredAdapterId;
    const adapterId = entry?.id;
    if (typeof configuredAdapterId !== 'string' || configuredAdapterId.length === 0) continue;
    if (typeof adapterId !== 'string' || adapterId.length === 0) continue;
    if (seen.has(configuredAdapterId)) continue;
    seen.add(configuredAdapterId);
    out.push({ configuredAdapterId, adapterId });
  }
  return out;
}

/**
 * The full flat set of (listing, channel) targets a run intends to attempt, each carrying its
 * deterministic ledger id AND the sorted snapshot of the listing's full intended channel set.
 *
 * The intended-set snapshot is durable repair evidence: a later reconcile can tell, from a single
 * ledger record, which channels the original run meant to reach without re-deriving it from a job
 * whose channels may since have changed.
 *
 * @param {Array<{id: string}>} listings Listings that survived every filter and are worth notifying.
 * @param {Array<{id?: string, configuredAdapterId?: string}>|null|undefined} notificationConfig
 * @param {string} [eventKey]
 * @returns {DeliveryTarget[]}
 */
export function planDeliveryTargets(listings, notificationConfig, eventKey = INITIAL_LISTING_NOTIFICATION_EVENT_KEY) {
  const grouped = planDeliveryByListing(listings, notificationConfig, eventKey);
  return grouped.flatMap((group) => group.targets);
}

/**
 * The run's plan grouped by listing: each entry carries the listing's intended-channel snapshot and
 * its per-channel targets. This is the single source of target identity — the orchestrator consumes
 * it directly so runtime iteration cannot drift from what the planner (and its tests) describe.
 *
 * @param {Array<{id: string}>} listings
 * @param {Array<{id?: string, configuredAdapterId?: string}>|null|undefined} notificationConfig
 * @param {string} [eventKey]
 * @returns {Array<{
 *   listingId: string,
 *   eventKey: string,
 *   intendedConfiguredAdapterIds: string[],
 *   intendedChannelCount: number,
 *   targets: DeliveryTarget[]
 * }>}
 */
export function planDeliveryByListing(listings, notificationConfig, eventKey = INITIAL_LISTING_NOTIFICATION_EVENT_KEY) {
  if (!Array.isArray(listings) || listings.length === 0) return [];
  const channels = resolveChannels(notificationConfig);
  if (channels.length === 0) return [];

  // A stable, sorted snapshot of the intended channel set — identical for every target of a listing.
  const intendedConfiguredAdapterIds = channels.map((c) => c.configuredAdapterId).sort();
  const intendedChannelCount = intendedConfiguredAdapterIds.length;

  const groups = [];
  for (const listing of listings) {
    const listingId = listing?.id;
    if (typeof listingId !== 'string' || listingId.length === 0) continue;
    const targets = channels.map((channel) => ({
      listingId,
      configuredAdapterId: channel.configuredAdapterId,
      adapterId: channel.adapterId,
      eventKey,
      deliveryId: deliveryDocId(listingId, channel.configuredAdapterId, eventKey),
      intendedConfiguredAdapterIds,
      intendedChannelCount,
    }));
    groups.push({ listingId, eventKey, intendedConfiguredAdapterIds, intendedChannelCount, targets });
  }
  return groups;
}

/**
 * Decide whether a listing's aggregate notification is complete.
 *
 * The aggregate `notificationComplete`/`notifiedAt` marker is a strong claim: the user was told
 * about this listing on every channel the run intended. It may be written only when
 *
 *   - the run intended at least one channel for the listing (a listing with no targets never
 *     claims notification success — that would be a lie about a notification that never went out),
 *     and
 *   - every intended channel is confirmed `sent`.
 *
 * A single channel left `sending`, `unknown`, `failed`, or otherwise not `sent` leaves the
 * aggregate incomplete, so a later reconcile can tell "not finished" from "done" without resending.
 *
 * @param {number} intendedChannelCount How many channels the run intended for this listing.
 * @param {number} sentChannelCount How many of those channels are confirmed sent.
 * @returns {boolean}
 */
export function isListingNotificationComplete(intendedChannelCount, sentChannelCount) {
  if (!Number.isFinite(intendedChannelCount) || intendedChannelCount <= 0) return false;
  if (!Number.isFinite(sentChannelCount) || sentChannelCount < 0) return false;
  return sentChannelCount >= intendedChannelCount;
}
