/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { InquiryDeliveryError } from '../inquiries/errors.js';

const BASE_URL = 'https://www.deutsche-wohnen.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INCOME_TYPES = new Set(['1', '2', '3', '4']);
const INCOME_AMOUNTS = new Set(['M_1', 'M_2', 'M_3', 'M_A']);
const headers = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

function objectIdOf(listing) {
  const link = typeof listing?.link === 'string' ? listing.link : '';
  const match = link.match(/-(\d+)(?:[/?#]|$)/);
  if (!match) {
    throw new InquiryDeliveryError('The Deutsche Wohnen listing id is missing.', {
      missingFields: ['listingId'],
    });
  }
  return match[1];
}

function splitName(value) {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : [];
  return parts.length >= 2 ? { firstname: parts[0], surename: parts.slice(1).join(' ') } : null;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Build the JSON body used by Deutsche Wohnen's public contact form.
 *
 * @param {Object} profile
 * @param {string} accountEmail Authenticated Fredy login email.
 * @param {string} message
 * @param {Object} contactConfig Provider-supplied field metadata.
 * @returns {{body: Object|null, missingFields: string[]}}
 */
export function buildDeutscheWohnenContact(profile, accountEmail, message, contactConfig = {}) {
  const name = splitName(profile?.name);
  const email = typeof accountEmail === 'string' ? accountEmail : '';
  const phone = typeof profile?.phoneNumber === 'string' ? profile.phoneNumber.trim() : '';
  const incomeType = profile?.deutscheWohnenIncomeType;
  const incomeAmount = profile?.deutscheWohnenMonthlyNetIncome;
  const configuredIncomeTypes = Object.keys(contactConfig?.incomeTypes?.availableKeyValues ?? {});
  const configuredIncomeAmounts = Object.keys(contactConfig?.incomeAmountTypes?.availableKeyValues ?? {});
  const allowedIncomeTypes = configuredIncomeTypes.length ? new Set(configuredIncomeTypes) : INCOME_TYPES;
  const allowedIncomeAmounts = configuredIncomeAmounts.length ? new Set(configuredIncomeAmounts) : INCOME_AMOUNTS;
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';
  const missingFields = [];

  if (!name) missingFields.push('name');
  if (!EMAIL_PATTERN.test(email)) missingFields.push('signedInEmail');
  if (!phone) missingFields.push('phoneNumber');
  if (!allowedIncomeTypes.has(incomeType)) missingFields.push('deutscheWohnenIncomeType');
  if (!allowedIncomeAmounts.has(incomeAmount)) missingFields.push('deutscheWohnenMonthlyNetIncome');
  if (profile?.deutscheWohnenPrivacyAccepted !== true) missingFields.push('deutscheWohnenPrivacyAccepted');
  if (!trimmedMessage) missingFields.push('message');

  if (missingFields.length > 0) return { body: null, missingFields };
  if (trimmedMessage.length > 2000) {
    throw new InquiryDeliveryError('The Deutsche Wohnen inquiry message exceeds 2,000 characters.', {
      status: 422,
    });
  }

  const incomeTypeField = contactConfig?.incomeTypes?.fieldId || 'einkommensart';
  const incomeAmountField = contactConfig?.incomeAmountTypes?.fieldId || 'monatliches_nettoeinkommen';
  return {
    body: {
      firstname: name.firstname,
      surename: name.surename,
      email,
      telephone: phone,
      message: trimmedMessage,
      customFields: {
        [incomeTypeField]: incomeType,
        [incomeAmountField]: incomeAmount,
      },
    },
    missingFields,
  };
}

/**
 * Submit one Deutsche Wohnen inquiry.
 *
 * The provider offers no validation-only operation. Fredy therefore validates every known field
 * locally, retrieves the live field metadata, and performs exactly one POST. Any network, timeout,
 * 5xx, unreadable response, or unrecognized 2xx after that POST is `unknown` and must not be
 * retried automatically.
 *
 * @param {{listing: Object, profile: Object, accountEmail: string, message: string, fetchImpl?: typeof fetch, timeoutMs?: number}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendDeutscheWohnenInquiry({
  listing,
  profile,
  accountEmail,
  message,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const objectId = objectIdOf(listing);
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;
  const url = `${BASE_URL}/api/deuwo-real-estate/${objectId}/contact-form`;

  let configResponse;
  let contactConfig;
  try {
    configResponse = await fetchWithTimeout(fetchImpl, url, { headers }, requestTimeoutMs);
    contactConfig = await responseJson(configResponse);
  } catch (error) {
    throw new InquiryDeliveryError('Could not read Deutsche Wohnen contact requirements.', {
      outcome: 'failed',
      cause: error,
    });
  }
  if (!configResponse.ok) {
    throw new InquiryDeliveryError('Could not read Deutsche Wohnen contact requirements.', {
      outcome: 'failed',
      status: configResponse.status,
    });
  }

  const { body, missingFields } = buildDeutscheWohnenContact(profile, accountEmail, message, contactConfig);
  if (missingFields.length > 0) {
    throw new InquiryDeliveryError('Required Deutsche Wohnen inquiry fields are missing.', {
      outcome: 'failed',
      missingFields,
    });
  }

  let sendResponse;
  try {
    sendResponse = await fetchWithTimeout(
      fetchImpl,
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('The Deutsche Wohnen inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }

  let result;
  try {
    result = await responseJson(sendResponse);
  } catch (error) {
    throw new InquiryDeliveryError('The Deutsche Wohnen inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }
  if (!sendResponse.ok) {
    const unknown = sendResponse.status >= 500;
    throw new InquiryDeliveryError(
      unknown ? 'The Deutsche Wohnen inquiry outcome is unknown.' : 'Deutsche Wohnen rejected the inquiry.',
      { outcome: unknown ? 'unknown' : 'failed', status: sendResponse.status },
    );
  }

  const confirmed =
    result === 'mail_sent' ||
    result?.success === true ||
    result?.status === 'mail_sent' ||
    (typeof result?.header === 'string' && result.header.trim()) ||
    (typeof result?.details === 'string' && result.details.trim());
  if (!confirmed) {
    throw new InquiryDeliveryError('The Deutsche Wohnen inquiry outcome is unknown.', { outcome: 'unknown' });
  }

  const providerReceipt = result?.requestId ?? result?.id;
  return {
    requestId:
      typeof providerReceipt === 'string' && providerReceipt.trim()
        ? providerReceipt.trim()
        : `deutscheWohnen:${objectId}`,
    sentAt: Date.now(),
  };
}
