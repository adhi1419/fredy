/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const present = (value) => typeof value === 'string' && value.trim().length > 0;
const INQUIRY_PROVIDERS = new Set(['deutscheWohnen', 'immoscout', 'inberlinwohnen']);
const DEUTSCHE_WOHNEN_INCOME_TYPES = new Set(['1', '2', '3', '4']);
const DEUTSCHE_WOHNEN_INCOME_AMOUNTS = new Set(['M_1', 'M_2', 'M_3', 'M_A']);

export function isInquiryProviderSupported(providerId, listing) {
  if (!INQUIRY_PROVIDERS.has(providerId)) return false;
  if (providerId !== 'inberlinwohnen' || listing == null) return true;
  try {
    const url = new URL(listing.link);
    return url.protocol === 'https:' && ['howoge.de', 'www.howoge.de'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function inquiryProviderRequiresMessage(providerId, listing) {
  return !(providerId === 'inberlinwohnen' && isInquiryProviderSupported(providerId, listing));
}

const BLOCKED_INQUIRY_SEND_STATUSES = new Set(['sending', 'sent', 'unknown']);

/**
 * Calculate the one send decision shared by every listing-detail inquiry control.
 *
 * A missing status is the initial state. Once a listing has a persisted status, only an explicit
 * `failed` outcome may be sent again; `sending`, `sent`, `unknown`, and any other persisted value
 * are deliberately blocked because the provider may already have received the request.
 *
 * @param {{providerId?: string, listing?: unknown, profile?: unknown, message?: unknown, status?: unknown}} input
 * @returns {{providerSupported: boolean, profileReady: boolean, messageReady: boolean, statusAllowsSend: boolean, canRetry: boolean, canSend: boolean}}
 */
export function getInquirySendEligibility({ providerId, listing, profile, message, status } = {}) {
  const persistedStatus = status == null ? '' : String(status).trim();
  const providerSupported = isInquiryProviderSupported(providerId, listing);
  const profileReady = isInquiryContactProfileReady(profile, providerId);
  const messageReady = !inquiryProviderRequiresMessage(providerId, listing) || present(message);
  const statusAllowsSend = persistedStatus === '' || persistedStatus === 'failed';
  const canRetry = persistedStatus === 'failed';

  return {
    providerSupported,
    profileReady,
    messageReady,
    statusAllowsSend: statusAllowsSend && !BLOCKED_INQUIRY_SEND_STATUSES.has(persistedStatus),
    canRetry,
    canSend: providerSupported && profileReady && messageReady && statusAllowsSend,
  };
}

/**
 * Whether the profile can attempt the selected provider's contact form.
 *
 * The signed-in email is deliberately absent: it is server-owned identity and cannot be supplied
 * or overridden by this profile. Provider validation remains authoritative.
 *
 * @param {Object|null|undefined} profile
 * @param {string} [providerId]
 * @returns {boolean}
 */
export function isInquiryContactProfileReady(profile, providerId = 'immoscout') {
  const hasName = present(profile?.name) && profile.name.trim().split(/\s+/).length >= 2;
  if (!hasName) return false;

  if (providerId === 'immoscout') {
    return (
      present(profile?.street) &&
      present(profile?.houseNumber) &&
      present(profile?.postcode) &&
      present(profile?.city) &&
      profile?.immoscoutPrivacyAccepted === true
    );
  }

  if (providerId === 'deutscheWohnen') {
    return (
      present(profile?.phoneNumber) &&
      DEUTSCHE_WOHNEN_INCOME_TYPES.has(profile?.deutscheWohnenIncomeType) &&
      DEUTSCHE_WOHNEN_INCOME_AMOUNTS.has(profile?.deutscheWohnenMonthlyNetIncome) &&
      profile?.deutscheWohnenPrivacyAccepted === true
    );
  }

  if (providerId === 'inberlinwohnen') {
    return profile?.howogeApplicationAccepted === true;
  }

  return false;
}
