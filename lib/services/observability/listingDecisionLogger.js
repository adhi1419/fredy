/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';

export const LISTING_DECISION_PREFIX = 'LISTING_DECISION ';

/**
 * Build the stable, privacy-safe event written for one listing decision.
 *
 * Only opaque identifiers and bounded decision metadata are accepted. Provider payloads, listing
 * titles and addresses, applicant data, inquiry text, and raw errors deliberately have no field in
 * this contract, so callers cannot accidentally copy personal data into production logs.
 *
 * @param {Object} input
 * @param {string} input.jobId
 * @param {string} input.providerId
 * @param {string} input.listingId
 * @param {'new'|'repair'} input.flow
 * @param {'stored'|'filtered'|'skipped'|'sent'|'failed'} input.decision
 * @param {string} input.reason
 * @param {string|null} [input.action]
 * @param {string|null} [input.status]
 * @returns {Object}
 */
export function listingDecisionEvent({
  jobId,
  providerId,
  listingId,
  flow,
  decision,
  reason,
  action = null,
  status = null,
}) {
  return {
    event: 'listing_decision',
    schemaVersion: 1,
    jobId: String(jobId ?? ''),
    providerId: String(providerId ?? ''),
    listingId: String(listingId ?? ''),
    flow,
    decision,
    reason,
    ...(action == null ? {} : { action }),
    ...(status == null ? {} : { status }),
  };
}

/**
 * Write one machine-readable listing decision to the normal production log stream.
 *
 * @param {Parameters<typeof listingDecisionEvent>[0]} input
 * @returns {Object} The emitted event, for deterministic tests and callers that need it.
 */
export function logListingDecision(input) {
  const event = listingDecisionEvent(input);
  logger.info(`${LISTING_DECISION_PREFIX}${JSON.stringify(event)}`);
  return event;
}
