/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const VALIDATION_MODES = new Set(['provider', 'local', 'none']);
const ELIGIBILITY_SCOPES = new Set(['provider', 'listing', 'none']);

/** Conservative capability for providers without a declared Fredy application adapter. */
export const UNSUPPORTED_APPLICATION_CAPABILITIES = Object.freeze({
  manual: false,
  automatic: false,
  eligibility: 'none',
  validation: 'none',
  profileRequirements: Object.freeze([]),
  consentRequirements: Object.freeze([]),
  connectionRequired: false,
});

/**
 * Normalize one declarative provider application capability into the stable public shape.
 * Opening a provider URL and manually recording "I applied" are universal listing actions, not
 * evidence that Fredy can submit an application for that provider; support therefore defaults off.
 *
 * @param {Object|null|undefined} declaration
 * @returns {{manual: boolean, automatic: boolean, eligibility: 'provider'|'listing'|'none', validation: 'provider'|'local'|'none', profileRequirements: string[], consentRequirements: string[], connectionRequired: boolean}}
 */
export function normalizeApplicationCapabilities(declaration) {
  const value = declaration && typeof declaration === 'object' ? declaration : {};
  const manual = value.manual === true;
  const automatic = value.automatic === true;
  const declaredEligibility = ELIGIBILITY_SCOPES.has(value.eligibility) ? value.eligibility : null;

  return {
    manual,
    automatic,
    eligibility: manual || automatic ? (declaredEligibility ?? 'provider') : 'none',
    validation: VALIDATION_MODES.has(value.validation) ? value.validation : 'none',
    profileRequirements: normalizeCategories(value.profileRequirements),
    consentRequirements: normalizeCategories(value.consentRequirements),
    connectionRequired: value.connectionRequired === true,
  };
}

/** Normalize provider metadata without changing existing fields. */
export function normalizeProviderMetaInformation(metaInformation) {
  const meta = metaInformation && typeof metaInformation === 'object' ? metaInformation : {};
  const capabilities = meta.capabilities && typeof meta.capabilities === 'object' ? meta.capabilities : {};
  return {
    ...meta,
    capabilities: {
      ...capabilities,
      application: normalizeApplicationCapabilities(capabilities.application),
    },
  };
}

function normalizeCategories(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))];
}
