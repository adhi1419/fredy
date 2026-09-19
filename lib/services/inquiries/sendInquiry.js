/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { sendImmoscoutInquiry } from '../immoscout/contactClient.js';
import { InquiryDeliveryError } from './errors.js';

const SENDERS = new Map([['immoscout', sendImmoscoutInquiry]]);

/**
 * Whether Fredy knows how to submit an inquiry through this provider.
 *
 * The registry is intentionally provider-neutral: InBerlinWohnen and Deutsche Wohnen can add an
 * adapter without putting provider-specific branches into the pipeline or API route.
 *
 * @param {string} providerId
 * @returns {boolean}
 */
export function supportsInquirySending(providerId) {
  return SENDERS.has(providerId);
}

/**
 * Validate and send one inquiry through the listing's provider.
 *
 * @param {{providerId: string, listing: Object, profile: Object, accountEmail: string, message: string, fetchImpl?: typeof fetch}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendInquiry(params) {
  const sender = SENDERS.get(params.providerId);
  if (sender == null) {
    throw new InquiryDeliveryError(`Inquiry sending is not supported for provider '${params.providerId}'.`);
  }
  return sender(params);
}
