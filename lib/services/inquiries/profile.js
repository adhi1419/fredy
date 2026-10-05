/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { isHowogeListing } from '../inberlinwohnen/howogeContactClient.js';
import { isStadtUndLandListing } from '../inberlinwohnen/wohnungsheldenContactClient.js';
import { isWbmListing } from '../inberlinwohnen/wbmContactClient.js';

/**
 * Remove fields whose value must come from authenticated server state.
 *
 * `email` existed briefly as an applicant-profile field during development. Keeping it out of both
 * storage and responses makes the login identity the only possible source for provider contact.
 *
 * @param {Object} profile
 * @returns {Object}
 */
export function sanitizeInquiryProfile(profile) {
  const sanitized = { ...profile };
  delete sanitized.email;
  return sanitized;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEUTSCHE_WOHNEN_INCOME_TYPES = new Set(['1', '2', '3', '4']);
const DEUTSCHE_WOHNEN_INCOME_AMOUNTS = new Set(['M_1', 'M_2', 'M_3', 'M_A']);
const WBM_INCOME_LIMITS = new Set(['100', '140', '160', '180', '220']);
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const nonNegativeInteger = (value) =>
  value !== '' && value != null && Number.isInteger(Number(value)) && Number(value) >= 0;
const positiveInteger = (value) => nonNegativeInteger(value) && Number(value) > 0;

function wbsProfileReady(profile, { requireIncomeLimit = false } = {}) {
  if (typeof profile?.wbsAvailable !== 'boolean') return false;
  if (!profile.wbsAvailable) return true;
  return (
    present(profile?.wbsValidUntil) &&
    positiveInteger(profile?.wbsMaxRooms) &&
    (!requireIncomeLimit || WBM_INCOME_LIMITS.has(String(profile?.wbsIncomeLimit))) &&
    (!requireIncomeLimit || typeof profile?.wbsSpecialNeed === 'boolean')
  );
}

function howogeProfileReady() {
  return true;
}

function wbmProfileReady(profile) {
  return present(profile?.salutation) && wbsProfileReady(profile, { requireIncomeLimit: true });
}

function stadtUndLandProfileReady(profile) {
  return (
    present(profile?.salutation) &&
    positiveInteger(profile?.numberOfPersons) &&
    nonNegativeInteger(profile?.numberOfChildren) &&
    present(profile?.moveInDate) &&
    present(profile?.netIncome) &&
    wbsProfileReady(profile)
  );
}

function inBerlinProfileReady(profile, listing) {
  if (listing == null) {
    return howogeProfileReady(profile) || wbmProfileReady(profile) || stadtUndLandProfileReady(profile);
  }
  if (isHowogeListing(listing)) return howogeProfileReady(profile);
  if (isWbmListing(listing)) return wbmProfileReady(profile);
  if (isStadtUndLandListing(listing)) return stadtUndLandProfileReady(profile);
  return false;
}

/**
 * Whether the common applicant facts explicitly entered during first-registration setup are
 * complete. Provider-specific employment, income and consent fields are intentionally excluded.
 *
 * @param {Object|null|undefined} profile
 * @returns {boolean}
 */
export function isCommonInquiryProfileReady(profile) {
  const hasFullName = present(profile?.name) && profile.name.trim().split(/\s+/).length >= 2;
  return (
    hasFullName &&
    present(profile?.street) &&
    present(profile?.houseNumber) &&
    present(profile?.postcode) &&
    present(profile?.city)
  );
}

/**
 * Whether the known provider-level and listing-partner fields are ready before a listing is reserved.
 *
 * Listing-specific remote validation remains authoritative. This check prevents an existing
 * auto-enabled job from consuming a newly found listing while the user still needs to configure
 * fields introduced by a newly supported provider.
 *
 * @param {Object|null|undefined} profile
 * @param {string|null|undefined} accountEmail
 * @param {string} providerId
 * @param {Object} [listing]
 * @returns {boolean}
 */
export function isInquiryProfileReady(profile, accountEmail, providerId, listing) {
  const hasName = present(profile?.name) && profile.name.trim().split(/\s+/).length >= 2;
  if (!hasName || !EMAIL_PATTERN.test(accountEmail ?? '')) return false;

  if (providerId === 'immoscout') {
    return (
      present(profile?.street) && present(profile?.houseNumber) && present(profile?.postcode) && present(profile?.city)
    );
  }
  if (providerId === 'deutscheWohnen') {
    return (
      present(profile?.phoneNumber) &&
      DEUTSCHE_WOHNEN_INCOME_TYPES.has(profile?.deutscheWohnenIncomeType) &&
      DEUTSCHE_WOHNEN_INCOME_AMOUNTS.has(profile?.deutscheWohnenMonthlyNetIncome)
    );
  }
  if (providerId === 'kleinanzeigen') return true;
  if (providerId === 'inberlinwohnen') return inBerlinProfileReady(profile, listing);
  return false;
}
