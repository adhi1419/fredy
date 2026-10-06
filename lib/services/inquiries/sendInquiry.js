/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { sendDeutscheWohnenInquiry } from '../deutscheWohnen/contactClient.js';
import { sendImmoscoutInquiry } from '../immoscout/contactClient.js';
import { sendKleinanzeigenInquiry } from '../kleinanzeigen/contactClient.js';
import { isHowogeListing, sendHowogeInquiry } from '../inberlinwohnen/howogeContactClient.js';
import { isStadtUndLandListing, sendWohnungsheldenInquiry } from '../inberlinwohnen/wohnungsheldenContactClient.js';
import { isWbmListing, sendWbmInquiry } from '../inberlinwohnen/wbmContactClient.js';
import { InquiryDeliveryError } from './errors.js';

const INBERLIN_SENDERS = [
  { supportsListing: isHowogeListing, send: sendHowogeInquiry, requiresMessage: false },
  { supportsListing: isWbmListing, send: sendWbmInquiry, requiresMessage: false },
  { supportsListing: isStadtUndLandListing, send: sendWohnungsheldenInquiry, requiresMessage: false },
];

const inBerlinSender = (listing) => INBERLIN_SENDERS.find((entry) => entry.supportsListing(listing));

async function sendInBerlinInquiry(params) {
  const sender = inBerlinSender(params.listing);
  if (sender == null) {
    throw new InquiryDeliveryError('This InBerlinWohnen partner does not support automatic applications.', {
      permanent: true,
    });
  }
  return sender.send(params);
}

const SENDERS = new Map([
  ['deutscheWohnen', { send: sendDeutscheWohnenInquiry, requiresMessage: true }],
  ['immoscout', { send: sendImmoscoutInquiry, requiresMessage: true }],
  ['kleinanzeigen', { send: sendKleinanzeigenInquiry, requiresMessage: true }],
  ['wbm', { send: sendWbmInquiry, requiresMessage: false }],
  [
    'inberlinwohnen',
    {
      send: sendInBerlinInquiry,
      requiresMessage: (listing) => inBerlinSender(listing)?.requiresMessage !== false,
      supportsListing: (listing) => inBerlinSender(listing) != null,
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
  if (!supportsInquirySending(providerId, listing)) return true;
  return typeof entry.requiresMessage === 'function' ? entry.requiresMessage(listing) : entry.requiresMessage !== false;
}

/**
 * Validate and send one inquiry through the listing's provider.
 *
 * @param {{providerId: string, listing: Object, profile: Object, userId: string, accountEmail: string, message: string, fetchImpl?: typeof fetch}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendInquiry(params) {
  const entry = SENDERS.get(params.providerId);
  if (!supportsInquirySending(params.providerId, params.listing)) {
    throw new InquiryDeliveryError(`Inquiry sending is not supported for provider '${params.providerId}'.`, {
      permanent: true,
    });
  }
  return entry.send(params);
}
