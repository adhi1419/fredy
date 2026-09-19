/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

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
