/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { sendDeutscheWohnenInquiry } from '../deutscheWohnen/contactClient.js';
import { sendImmoscoutInquiry } from '../immoscout/contactClient.js';
import { isHowogeListing, sendHowogeInquiry } from '../inberlinwohnen/howogeContactClient.js';
import { InquiryDeliveryError } from './errors.js';

const SENDERS = new Map([
  ['deutscheWohnen', { send: sendDeutscheWohnenInquiry, requiresMessage: true }],
  ['immoscout', { send: sendImmoscoutInquiry, requiresMessage: true }],
  [
    'inberlinwohnen',
    {
      send: sendHowogeInquiry,
      requiresMessage: false,
      supportsListing: isHowogeListing,
    },
  ],
]);

/**
 * Whether Fredy knows how to submit an inquiry through this provider.
 *
 * The registry is intentionally provider-neutral: additional InBerlinWohnen partner flows can add an
 * adapter without putting provider-specific branches into the pipeline or API route.
 *
 * @param {string} providerId
 * @param {Object} [listing]
 * @returns {boolean}
 */
export function supportsInquirySending(providerId, listing) {
  const entry = SENDERS.get(providerId);
  return entry != null && (listing == null || entry.supportsListing == null || entry.supportsListing(listing));
}

/**
 * Whether delivery requires a non-empty generated or edited message.
 *
 * @param {string} providerId
 * @param {Object} [listing]
 * @returns {boolean}
 */
export function inquiryRequiresMessage(providerId, listing) {
  const entry = SENDERS.get(providerId);
  return !supportsInquirySending(providerId, listing) || entry.requiresMessage !== false;
}

/**
 * Validate and send one inquiry through the listing's provider.
 *
 * @param {{providerId: string, listing: Object, profile: Object, accountEmail: string, message: string, fetchImpl?: typeof fetch}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendInquiry(params) {
  const entry = SENDERS.get(params.providerId);
  if (!supportsInquirySending(params.providerId, params.listing)) {
    throw new InquiryDeliveryError(`Inquiry sending is not supported for provider '${params.providerId}'.`);
  }
  return entry.send(params);
}
