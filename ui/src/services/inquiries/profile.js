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
