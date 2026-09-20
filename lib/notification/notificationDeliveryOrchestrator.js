/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * notificationDeliveryOrchestrator — the thin wiring between the pure planner, the delivery ledger,
 * and a single-channel adapter send.
 *
 * It replaces the old "fan out one batch to every adapter, then blanket-mark every listing
 * complete" path with a per-(listing, channel) loop that reserves before it sends, so the external
 * world sees at most one automatic attempt per logical delivery and a second run over the same
 * listings is externally inert.
 *
 * Target identity comes from the planner ({@link planDeliveryByListing}) — runtime never
 * reimplements iteration, so what is reserved cannot drift from what the planner (and its tests)
 * describe. Each reservation snapshots the listing's intended channel set as durable repair
 * evidence.
 *
 * Ordering is deliberate and sequential: channels within a listing, and listings within a run, are
 * attempted one at a time. Adapters (Telegram, Gemini-backed message generation) do their own
 * throttling and pacing; issuing their sends serially preserves that pacing and avoids the parallel
 * bursts a fan-out would create.
 *
 * The aggregate `notificationComplete`/`notifiedAt` marker is written only when every channel the
 * run intended for a listing is confirmed sent — where "confirmed" means the `sent` settlement was
 * durably accepted by the ledger (finishDelivery returned 1), OR the channel was already `sent` in
 * the ledger from a prior run. A channel whose sent-settlement did not stick (finishDelivery 0/throw)
 * is treated as unknown, never re-sent, and leaves the aggregate incomplete. A listing with no
 * configured channels is never marked complete.
 */

import logger from '../services/logger.js';
import { isListingNotificationComplete, planDeliveryByListing } from './notificationDeliveryPlanner.js';
import { INITIAL_LISTING_NOTIFICATION_EVENT_KEY } from '../services/storage/firestore/collections.js';

/**
 * @typedef {Object} OrchestratorDeps
 * @property {(params: Object) => Promise<{reserved: boolean, state: string, deliveryId: string}>} reserveDelivery
 * @property {(deliveryId: string, result: Object) => Promise<number>} finishDelivery
 * @property {(params: Object) => Promise<any>} sendOneToChannel
 * @property {(listingId: string, notifiedAt: number) => Promise<number>} markNotificationComplete
 * @property {() => number} [now]
 */

/**
 * Run the per-listing/per-channel notification for one batch of new listings.
 *
 * @param {Object} params
 * @param {Array<{id: string}>} params.listings Formatted listings that survived every filter. Each
 *   carries the deterministic listing id; `id` doubles as the listingId in the ledger.
 * @param {Array<{id?: string, name?: string, fields?: Object, configuredAdapterId?: string}>} params.notificationConfig
 *   The job's hydrated channels.
 * @param {string} params.serviceName Provider id, used only for adapter message context.
 * @param {string} params.jobId
 * @param {string} params.ownerUserId Job owner identity the scheduler acts as.
 * @param {string} params.baseUrl
 * @param {OrchestratorDeps} deps Injected storage + send + clock, so the orchestration is testable
 *   without Firestore or real adapters.
 * @param {string} [eventKey]
 * @returns {Promise<{
 *   attempted: number, sent: number, blocked: number, unknown: number,
 *   listingsCompleted: number, listingsWithTargets: number
 * }>}
 */
export async function orchestrateNotificationDelivery(
  { listings, notificationConfig, serviceName, jobId, ownerUserId, baseUrl },
  deps,
  eventKey = INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
) {
  const { reserveDelivery, finishDelivery, sendOneToChannel, markNotificationComplete, now = Date.now } = deps;

  // Target identity is the planner's alone. Runtime consumes its per-listing grouping directly.
  const plan = planDeliveryByListing(listings, notificationConfig, eventKey);
  const summary = {
    attempted: 0,
    sent: 0,
    blocked: 0,
    unknown: 0,
    listingsCompleted: 0,
    listingsWithTargets: 0,
  };

  if (plan.length === 0) {
    // No listings, or no configured channels: nothing is attempted and — critically — nothing is
    // ever marked notification-complete for a listing with no targets.
    return summary;
  }

  // Map an adapterId back to the hydrated channel entry so we hand the adapter the exact single
  // channel (its own credentials), keyed by the per-channel configuredAdapterId.
  const channelEntryById = new Map();
  for (const entry of notificationConfig ?? []) {
    if (entry?.configuredAdapterId && !channelEntryById.has(entry.configuredAdapterId)) {
      channelEntryById.set(entry.configuredAdapterId, entry);
    }
  }

  for (const group of plan) {
    const { listingId, intendedConfiguredAdapterIds, intendedChannelCount, targets } = group;
    summary.listingsWithTargets += 1;
    let sentForListing = 0;

    const listing = listings.find((l) => l?.id === listingId);

    for (const target of targets) {
      const { configuredAdapterId, adapterId, deliveryId } = target;
      let reservation;
      try {
        reservation = await reserveDelivery({
          listingId,
          configuredAdapterId,
          adapterId,
          ownerUserId,
          jobId,
          eventKey,
          intendedConfiguredAdapterIds,
          intendedChannelCount,
          now: now(),
        });
      } catch (err) {
        // A reservation write that fails has produced no side effect; leave it unattempted and let
        // a later run try again. It must not count toward completion. Log high-level context only.
        summary.blocked += 1;
        logger.warn(
          `Could not reserve notification delivery for listing ${listingId} / channel ${configuredAdapterId}`,
          err?.message ?? err,
        );
        continue;
      }

      if (!reservation.reserved) {
        // Blocked by a prior state. Only an already-`sent` record counts toward completion; a
        // `sending`/`unknown` record leaves the aggregate deliberately incomplete.
        summary.blocked += 1;
        if (reservation.state === 'sent') sentForListing += 1;
        continue;
      }

      summary.attempted += 1;
      const entry = channelEntryById.get(configuredAdapterId);
      try {
        await sendOneToChannel({ serviceName, listing, channel: entry, jobKey: jobId, baseUrl });
        // The send resolved AND its resolved value proved no failure. Only count this channel as
        // sent if the ledger DURABLY accepted the sent settlement (returned 1). A 0 means the record
        // was no longer `sending` (raced/settled elsewhere) — we do NOT re-send and do NOT count it,
        // so a settlement that did not stick can never produce a false notificationComplete.
        const settled = await finishDelivery(reservation.deliveryId ?? deliveryId, {
          state: 'sent',
          sentAt: now(),
          now: now(),
        });
        if (settled === 1) {
          summary.sent += 1;
          sentForListing += 1;
        } else {
          summary.unknown += 1;
          logger.warn(
            `Sent settlement not durably accepted for listing ${listingId} / channel ${configuredAdapterId}; leaving aggregate incomplete`,
          );
        }
      } catch {
        // Current adapters cannot prove a rejection happened before their side effect, so the
        // outcome is ambiguous and resolves to `unknown` — terminal for automation, never
        // auto-retried. Only a closed non-secret code is persisted; the raw error (which may embed a
        // webhook URL/token) is never written to the ledger. Logging keeps high-level context only.
        summary.unknown += 1;
        logger.warn(`Notification delivery outcome unknown for listing ${listingId} / channel ${configuredAdapterId}`);
        try {
          await finishDelivery(reservation.deliveryId ?? deliveryId, {
            state: 'unknown',
            errorCode: 'adapter_outcome_unknown',
            now: now(),
          });
        } catch {
          logger.warn(`Could not settle notification delivery ${reservation.deliveryId ?? deliveryId} to unknown`);
        }
      }
    }

    if (isListingNotificationComplete(intendedChannelCount, sentForListing)) {
      // Every intended channel confirmed sent — the aggregate claim is now true. Write-once; a
      // second run finds the flag already set and makes no write.
      try {
        const flipped = await markNotificationComplete(listingId, now());
        if (flipped) summary.listingsCompleted += 1;
      } catch (err) {
        logger.warn(`Could not persist notification-complete for listing ${listingId}`, err?.message ?? err);
      }
    }
  }

  return summary;
}
