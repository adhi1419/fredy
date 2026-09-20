/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * notificationLedgerStorage — Firestore implementation of the per-listing/per-channel notification
 * delivery ledger.
 *
 * One document per logical (listing, channel, event) action, keyed deterministically by
 * {@link deliveryDocId}. It is the single source of truth for "was this exact notification already
 * attempted?", and its only job is to make an automatic duplicate send impossible.
 *
 * State machine (camelCase field `state`):
 *   (absent) --reserve--> sending --finish(sent)--> sent      (terminal, success)
 *                          sending --finish(unknown)--> unknown (terminal for automation)
 *                          sending --finish(failed)--> failed  (proven pre-side-effect failure)
 *
 * What blocks a fresh automatic reservation: a terminal `sent`, an in-flight `sending`, and an
 * `unknown`. Only `failed` is reservable again, through the SAME reserve path a first attempt takes.
 * `failed` means a PROVEN pre-side-effect failure — the send provably never reached the outside
 * world — so retrying it is safe and needs no human. Note that the current adapter orchestration
 * never classifies an automatic outcome as `failed`: an adapter rejection or ambiguous resolution
 * is recorded `unknown` (never auto-retried), because current adapters cannot prove a rejection
 * happened before their side effect. `failed` therefore exists for provable-pre-side-effect callers
 * (and future adapters that can classify), not for today's ambiguous automatic path.
 *
 * The crash-safety guarantee: if the process dies after a reservation but before (or during) the
 * finish write, the record is left `sending`. `sending` blocks, so the ambiguous case — an external
 * side effect may already have happened — is never auto-retried.
 *
 * Ledger documents NEVER carry channel secret fields (tokens, webhooks, passwords) NOR raw adapter
 * error strings (which can embed a webhook URL/token). Failure detail is a closed `errorCode` drawn
 * from {@link SAFE_ERROR_CODES}; anything else is dropped.
 */

import FirestoreConnection from './FirestoreConnection.js';
import {
  BATCH_LIMIT,
  COLLECTIONS,
  batched,
  deliveryDocId,
  INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
} from './collections.js';

/** @typedef {'sending'|'sent'|'unknown'|'failed'} DeliveryState */

/** Current ledger document schema version. Stored on every record for forward migration. */
export const LEDGER_SCHEMA_VERSION = 1;

/** States that must block a fresh automatic reservation. `failed` is intentionally absent. */
const BLOCKING_STATES = Object.freeze(new Set(['sending', 'sent', 'unknown']));

/** Terminal finish states an adapter attempt may resolve to. */
const FINISH_STATES = Object.freeze(new Set(['sent', 'unknown', 'failed']));

/**
 * The closed set of non-secret failure codes the ledger may persist. Any code outside this set is
 * dropped (stored as null) rather than written, so no free-form adapter text — which can contain a
 * webhook URL or token — ever lands in a ledger document.
 */
export const SAFE_ERROR_CODES = Object.freeze(new Set(['adapter_outcome_unknown', 'adapter_rejected_pre_side_effect']));

/** Constrain a caller-supplied code to the safe set; unknown/absent → null. */
const sanitizeErrorCode = (code) => (SAFE_ERROR_CODES.has(code) ? code : null);

const deliveriesCol = () => FirestoreConnection.collection(COLLECTIONS.NOTIFICATION_DELIVERIES);

/**
 * Map a delivery snapshot to the public ledger row shape (camelCase). Secrets and raw errors are
 * never present in the stored document, so none can leak here.
 *
 * @param {FirebaseFirestore.DocumentSnapshot} snap
 * @returns {Object|null}
 */
const mapDelivery = (snap) => {
  if (!snap?.exists) return null;
  const d = snap.data();
  return {
    id: snap.id,
    schemaVersion: d.schemaVersion ?? null,
    ownerUserId: d.ownerUserId ?? null,
    jobId: d.jobId ?? null,
    listingId: d.listingId ?? null,
    configuredAdapterId: d.configuredAdapterId ?? null,
    adapterId: d.adapterId ?? null,
    eventKey: d.eventKey ?? null,
    state: d.state ?? null,
    attempts: d.attempts ?? 0,
    intendedConfiguredAdapterIds: Array.isArray(d.intendedConfiguredAdapterIds) ? d.intendedConfiguredAdapterIds : [],
    intendedChannelCount: d.intendedChannelCount ?? 0,
    errorCode: d.errorCode ?? null,
    createdAt: d.createdAt ?? null,
    updatedAt: d.updatedAt ?? null,
    reservedAt: d.reservedAt ?? null,
    sentAt: d.sentAt ?? null,
    finishedAt: d.finishedAt ?? null,
  };
};

/**
 * Read one ledger record by its logical identity.
 *
 * @param {{listingId: string, configuredAdapterId: string, eventKey?: string}} target
 * @returns {Promise<Object|null>}
 */
export const getDelivery = async ({
  listingId,
  configuredAdapterId,
  eventKey = INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
}) => {
  if (!listingId || !configuredAdapterId) return null;
  const id = deliveryDocId(listingId, configuredAdapterId, eventKey);
  const snap = await deliveriesCol().doc(id).get();
  return mapDelivery(snap);
};

/**
 * Read one ledger record by its deterministic document id.
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export const getDeliveryById = async (id) => {
  if (!id) return null;
  const snap = await deliveriesCol().doc(id).get();
  return mapDelivery(snap);
};

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const canonicalIntendedChannels = (configuredAdapterId, intendedConfiguredAdapterIds, intendedChannelCount) => {
  const intendedIds = intendedConfiguredAdapterIds == null ? [configuredAdapterId] : [...intendedConfiguredAdapterIds];
  if (
    intendedIds.length === 0 ||
    intendedIds.some((value) => !nonEmptyString(value)) ||
    new Set(intendedIds).size !== intendedIds.length ||
    !intendedIds.includes(configuredAdapterId)
  ) {
    throw new Error('reserveDelivery requires a distinct intended channel set containing the target channel');
  }
  intendedIds.sort();
  const intendedCount = intendedChannelCount ?? intendedIds.length;
  if (!Number.isInteger(intendedCount) || intendedCount !== intendedIds.length) {
    throw new Error('reserveDelivery requires intendedChannelCount to match the intended channel set');
  }
  return { intendedIds, intendedCount };
};

/**
 * Atomically reserve one (listing, channel, event) delivery before any adapter side effect.
 *
 * Returns `{ reserved: true }` only when this call moved the record into `sending`; any blocking
 * prior state returns `{ reserved: false, state }` and the caller must not send. The whole check
 * and write happen inside one transaction, so two concurrent runs cannot both win the reservation.
 *
 * Every field of identity/ownership must be a non-empty string before evidence is created — a
 * ledger record with a blank owner or job is not usable repair evidence. On a first reservation the
 * record snapshots the run's intended channel set (sorted `intendedConfiguredAdapterIds` +
 * `intendedChannelCount`) and stamps `schemaVersion`/`createdAt`. An eligible re-reservation
 * (only from a prior `failed`) preserves `createdAt` and refreshes `updatedAt`.
 *
 * @param {Object} params
 * @param {string} params.listingId
 * @param {string} params.configuredAdapterId Channel row id — the per-channel ledger identity.
 * @param {string} params.adapterId Adapter type that will send.
 * @param {string} params.ownerUserId Job owner; the identity the internal scheduler acts as.
 * @param {string} params.jobId
 * @param {string} [params.eventKey]
 * @param {string[]} [params.intendedConfiguredAdapterIds] Sorted intended channel set for this
 *   listing+event (from the planner). Defaults to just this channel.
 * @param {number} [params.intendedChannelCount] Size of the intended set.
 * @param {number} [params.now]
 * @returns {Promise<{reserved: boolean, state: DeliveryState, deliveryId: string}>}
 */
export const reserveDelivery = async ({
  listingId,
  configuredAdapterId,
  adapterId,
  ownerUserId,
  jobId,
  eventKey = INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
  intendedConfiguredAdapterIds,
  intendedChannelCount,
  now = Date.now(),
}) => {
  // Require every identity field before creating evidence. A blank owner/job/adapter/event makes
  // the record useless as repair evidence and must never be written.
  for (const [name, value] of [
    ['listingId', listingId],
    ['configuredAdapterId', configuredAdapterId],
    ['adapterId', adapterId],
    ['ownerUserId', ownerUserId],
    ['jobId', jobId],
    ['eventKey', eventKey],
  ]) {
    if (!nonEmptyString(value)) {
      throw new Error(`reserveDelivery requires a non-empty ${name}`);
    }
  }

  const { intendedIds, intendedCount } = canonicalIntendedChannels(
    configuredAdapterId,
    intendedConfiguredAdapterIds,
    intendedChannelCount,
  );

  const id = deliveryDocId(listingId, configuredAdapterId, eventKey);
  const ref = deliveriesCol().doc(id);
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (snap.exists) {
      const data = snap.data();
      const state = data.state ?? null;
      if (BLOCKING_STATES.has(state)) {
        return { reserved: false, state, deliveryId: id };
      }
      if (state !== 'failed') {
        throw new Error(`Cannot reserve notification delivery from invalid state '${String(state)}'`);
      }
      const identityMatches =
        data.schemaVersion === LEDGER_SCHEMA_VERSION &&
        data.ownerUserId === ownerUserId &&
        data.jobId === jobId &&
        data.listingId === listingId &&
        data.configuredAdapterId === configuredAdapterId &&
        data.adapterId === adapterId &&
        data.eventKey === eventKey;
      if (!identityMatches) {
        throw new Error('Cannot reserve notification delivery with mismatched stored identity');
      }
      // A prior `failed` is a proven-pre-side-effect failure, safe to retry through the normal
      // path. Preserve its original identity, intended-target snapshot, and createdAt.
      transaction.update(ref, {
        state: 'sending',
        reservedAt: now,
        updatedAt: now,
        sentAt: null,
        finishedAt: null,
        errorCode: null,
        attempts: (data.attempts ?? 0) + 1,
      });
      return { reserved: true, state: 'sending', deliveryId: id };
    }
    transaction.set(ref, {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      ownerUserId,
      jobId,
      listingId,
      configuredAdapterId,
      adapterId,
      eventKey,
      state: 'sending',
      attempts: 1,
      intendedConfiguredAdapterIds: intendedIds,
      intendedChannelCount: intendedCount,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      reservedAt: now,
      sentAt: null,
      finishedAt: null,
    });
    return { reserved: true, state: 'sending', deliveryId: id };
  });
};

/**
 * Finish a reserved delivery. Only a record currently `sending` may be finished, so a stray finish
 * (double-callback, race) is a no-op that returns 0. `sent` stamps `sentAt`; `unknown`/`failed`
 * record a closed non-secret `errorCode` (any other code is dropped).
 *
 * `unknown` is the resolution for an ambiguous adapter outcome — terminal for automation, never
 * auto-retried. `failed` is a proven pre-side-effect failure, safely retryable through the normal
 * reservation path.
 *
 * @param {string} deliveryId Deterministic ledger id from {@link reserveDelivery}.
 * @param {{state: DeliveryState, sentAt?: number|null, errorCode?: string|null, now?: number}} result
 * @returns {Promise<number>} 1 when it settled the record, 0 when it was not `sending`.
 */
export const finishDelivery = async (deliveryId, { state, sentAt = null, errorCode = null, now = Date.now() }) => {
  if (!deliveryId) return 0;
  if (!FINISH_STATES.has(state)) {
    throw new Error(`Invalid delivery finish state: ${state}`);
  }
  const ref = deliveriesCol().doc(deliveryId);
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data().state !== 'sending') return 0;
    transaction.update(ref, {
      state,
      updatedAt: now,
      finishedAt: now,
      sentAt: state === 'sent' ? (sentAt ?? now) : null,
      errorCode: state === 'sent' ? null : sanitizeErrorCode(errorCode),
    });
    return 1;
  });
};

const DELIVERY_QUERY_LIMIT = Math.min(BATCH_LIMIT, 30);

/**
 * Remove delivery evidence for listings that are being hard-deleted. Soft-deleted listing
 * tombstones deliberately retain their delivery records so restoration cannot trigger duplicates.
 *
 * @param {string[]} listingIds
 * @returns {Promise<number>} number of delivery records removed
 */
export const deleteDeliveriesForListingIds = async (listingIds) => {
  const unique = [...new Set((Array.isArray(listingIds) ? listingIds : []).filter((id) => nonEmptyString(id)))];
  let changes = 0;
  for (let i = 0; i < unique.length; i += DELIVERY_QUERY_LIMIT) {
    const snapshot = await deliveriesCol()
      .where('listingId', 'in', unique.slice(i, i + DELIVERY_QUERY_LIMIT))
      .get();
    await batched(snapshot.docs, (batch, doc) => batch.delete(doc.ref));
    changes += snapshot.size;
  }
  return changes;
};

/**
 * Remove every delivery record belonging to a job after its listings are hard-deleted.
 *
 * @param {string} jobId
 * @returns {Promise<number>} number of delivery records removed
 */
export const deleteDeliveriesForJobId = async (jobId) => {
  if (!nonEmptyString(jobId)) return 0;
  const snapshot = await deliveriesCol().where('jobId', '==', jobId).get();
  await batched(snapshot.docs, (batch, doc) => batch.delete(doc.ref));
  return snapshot.size;
};

export { BLOCKING_STATES, FINISH_STATES };
