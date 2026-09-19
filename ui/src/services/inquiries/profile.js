/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const present = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Whether the profile can attempt the common ImmoScout contact form.
 *
 * The signed-in email is deliberately absent: it is server-owned identity and cannot be supplied
 * or overridden by this profile. A particular listing may demand additional structured fields;
 * the provider validation remains authoritative and safely skips those listings.
 *
 * @param {Object|null|undefined} profile
 * @returns {boolean}
 */
export function isInquiryContactProfileReady(profile) {
  return (
    present(profile?.name) &&
    profile.name.trim().split(/\s+/).length >= 2 &&
    present(profile?.street) &&
    present(profile?.houseNumber) &&
    present(profile?.postcode) &&
    present(profile?.city) &&
    profile?.immoscoutPrivacyAccepted === true
  );
}
