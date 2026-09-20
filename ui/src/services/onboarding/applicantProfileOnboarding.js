/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** Route used only during mandatory first-registration profile setup. */
export const APPLICANT_PROFILE_ONBOARDING_PATH = '/onboarding/applicant-profile';

/** Common facts required before the authenticated user can enter product routes. */
export const REQUIRED_COMMON_PROFILE_FIELDS = Object.freeze(['name', 'street', 'houseNumber', 'postcode', 'city']);

const present = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Return common applicant fields that are missing or invalid, in form order.
 * Provider-specific income, employment and consent fields are intentionally excluded.
 *
 * @param {Object|null|undefined} profile
 * @returns {string[]}
 */
export function getInvalidCommonApplicantProfileFields(profile) {
  return REQUIRED_COMMON_PROFILE_FIELDS.filter((field) => {
    if (field === 'name') {
      return !present(profile?.name) || profile.name.trim().split(/\s+/).length < 2;
    }
    return !present(profile?.[field]);
  });
}

/**
 * Whether a persisted inquiry profile contains the explicitly entered common applicant facts.
 * Provider-specific income, employment and consent fields are intentionally not part of this check.
 *
 * @param {Object|null|undefined} profile
 * @returns {boolean}
 */
export function isCommonApplicantProfileComplete(profile) {
  return getInvalidCommonApplicantProfileFields(profile).length === 0;
}

/**
 * Resolve the one onboarding state used by the route guard and the onboarding page.
 *
 * `settingsLoaded` is deliberately separate from profile completeness: an empty profile while the
 * settings request is in flight must not redirect a signed-in user, and a failed save must keep the
 * draft on the onboarding route instead of starting a redirect loop.
 *
 * @param {{settingsLoaded?: boolean, settingsLoadFailed?: boolean, profile?: Object|null, pathname?: string, saveError?: unknown}} input
 * @returns {{status: 'loading'|'load-failed'|'incomplete'|'complete'|'save-failed', requiresSetup: boolean, shouldRedirect: boolean, path: string}}
 */
export function resolveApplicantProfileOnboarding({
  settingsLoaded = false,
  settingsLoadFailed = false,
  profile = null,
  pathname = APPLICANT_PROFILE_ONBOARDING_PATH,
  saveError = null,
} = {}) {
  if (settingsLoaded !== true) {
    return { status: 'loading', requiresSetup: false, shouldRedirect: false, path: APPLICANT_PROFILE_ONBOARDING_PATH };
  }

  if (settingsLoadFailed === true) {
    return {
      status: 'load-failed',
      requiresSetup: false,
      shouldRedirect: false,
      path: APPLICANT_PROFILE_ONBOARDING_PATH,
    };
  }

  if (isCommonApplicantProfileComplete(profile)) {
    return { status: 'complete', requiresSetup: false, shouldRedirect: false, path: APPLICANT_PROFILE_ONBOARDING_PATH };
  }

  const status = saveError == null ? 'incomplete' : 'save-failed';
  return {
    status,
    requiresSetup: true,
    shouldRedirect: pathname !== APPLICANT_PROFILE_ONBOARDING_PATH,
    path: APPLICANT_PROFILE_ONBOARDING_PATH,
  };
}
