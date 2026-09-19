/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { finishInquirySend, reserveInquirySend, setInquiryMessage } from '../storage/listingsStorage.js';
import { InquiryDeliveryError } from './errors.js';
import { inquiryRequiresMessage, sendInquiry } from './sendInquiry.js';

/**
 * Deliver one inquiry after atomically reserving the listing.
 *
 * The reservation is the duplicate barrier shared by manual and automatic sends. A process loss
 * leaves `sending`, which intentionally cannot be retried automatically: the remote provider may
 * already have received the request. Only an explicit `failed` outcome is eligible for a later
 * manual retry.
 *
 * @param {{providerId: string, listing: Object, profile: Object, accountEmail: string, message: string, fetchImpl?: typeof fetch}} params
 * @returns {Promise<{started: boolean, status: string, requestId?: string, sentAt?: number}>}
 */
export async function deliverInquiry({ providerId, listing, profile, accountEmail, message, fetchImpl }) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed && inquiryRequiresMessage(providerId, listing)) {
    throw new InquiryDeliveryError('The inquiry message is empty.');
  }

  const startedAt = Date.now();
  const started = await reserveInquirySend(listing.id, startedAt);
  if (!started) {
    return { started: false, status: listing.inquiry_send_status ?? listing.inquirySendStatus ?? 'blocked' };
  }

  if (trimmed) {
    try {
      await setInquiryMessage(listing.id, trimmed);
    } catch (error) {
      await finishInquirySend(listing.id, { status: 'failed', error: 'Could not store the inquiry message.' });
      throw new InquiryDeliveryError('Could not store the inquiry message.', { cause: error });
    }
  }

  let result;
  try {
    result = await sendInquiry({ providerId, listing, profile, accountEmail, message: trimmed, fetchImpl });
  } catch (error) {
    const status = error?.outcome === 'unknown' ? 'unknown' : 'failed';
    const safeMessage = error instanceof Error ? error.message.slice(0, 500) : 'Inquiry delivery failed.';
    await finishInquirySend(listing.id, { status, error: safeMessage });
    if (trimmed) listing.inquiryMessage = trimmed;
    listing.inquirySendStatus = status;
    throw error;
  }

  let completed;
  try {
    completed = await finishInquirySend(listing.id, {
      status: 'sent',
      requestId: result.requestId,
      sentAt: result.sentAt,
    });
  } catch (error) {
    listing.inquirySendStatus = 'unknown';
    throw new InquiryDeliveryError('The provider accepted the inquiry, but Fredy could not store the result.', {
      outcome: 'unknown',
      cause: error,
    });
  }
  if (completed !== 1) {
    listing.inquirySendStatus = 'unknown';
    throw new InquiryDeliveryError('The provider accepted the inquiry, but its local state changed unexpectedly.', {
      outcome: 'unknown',
    });
  }

  if (trimmed) listing.inquiryMessage = trimmed;
  listing.inquirySendStatus = 'sent';
  listing.inquiryRequestId = result.requestId;
  listing.inquirySentAt = result.sentAt;
  return { started: true, status: 'sent', ...result };
}
