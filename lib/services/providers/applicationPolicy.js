/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getProviders } from '../../utils.js';
import { UNSUPPORTED_APPLICATION_CAPABILITIES } from './capabilities.js';

export const APPLICATION_POLICY_STATES = Object.freeze({
  ENABLED: 'enabled',
  DISABLED: 'disabled',
});

const PROVIDER_SOURCE_FIELDS = Object.freeze(['id', 'name', 'url', 'enabled']);

/**
 * The policy stored on each job provider source. The state is deliberately a string so the API
 * can grow with additional guided states without overloading a boolean.
 *
 * @typedef {{automatic: 'enabled'|'disabled'}} ApplicationPolicy
 */

export class ApplicationPolicyValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApplicationPolicyValidationError';
    this.code = 'APPLICATION_POLICY_INVALID';
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasOwn(value, key) {
  return value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Normalize one source policy. A persisted source policy wins on reads. On writes that explicitly supply
 * the legacy job-level flag, that flag remains authoritative during the compatibility window so old
 * clients can continue toggling automatic applications. Policy-only writes use the source state.
 *
 * Legacy true is intentionally clipped to disabled for unsupported providers instead of being
 * rejected: old jobs may have enabled the job-level flag before provider capabilities existed.
 * New explicit source enables are rejected, so the new policy cannot claim unsupported support.
 * Listing-scoped capabilities are valid here; their listing-level eligibility is a later seam.
 *
 * @param {unknown} input
 * @param {object} capability
 * @param {boolean|null|undefined} legacyAutoSendInquiry
 * @param {{explicit?: boolean, legacyPrecedence?: boolean}} [options]
 * @returns {ApplicationPolicy}
 */
export function normalizeApplicationPolicy(input, capability, legacyAutoSendInquiry = null, options = {}) {
  const explicit = options.explicit ?? hasOwn(input, 'automatic');
  const legacyPrecedence = options.legacyPrecedence === true && typeof legacyAutoSendInquiry === 'boolean';
  const automatic = input?.automatic;
  let requestedState;

  if (explicit) {
    if (automatic === APPLICATION_POLICY_STATES.ENABLED || automatic === true) {
      requestedState = APPLICATION_POLICY_STATES.ENABLED;
    } else if (automatic === APPLICATION_POLICY_STATES.DISABLED || automatic === false) {
      requestedState = APPLICATION_POLICY_STATES.DISABLED;
    } else {
      throw new ApplicationPolicyValidationError('applicationPolicy.automatic must be either enabled or disabled.');
    }
  } else {
    requestedState =
      legacyAutoSendInquiry === true ? APPLICATION_POLICY_STATES.ENABLED : APPLICATION_POLICY_STATES.DISABLED;
  }

  // Validate an explicit enable even when the legacy compatibility value will win this write.
  if (explicit && requestedState === APPLICATION_POLICY_STATES.ENABLED && capability?.automatic !== true) {
    throw new ApplicationPolicyValidationError('Automatic application is not supported by the selected provider.');
  }

  const state = legacyPrecedence
    ? legacyAutoSendInquiry === true
      ? APPLICATION_POLICY_STATES.ENABLED
      : APPLICATION_POLICY_STATES.DISABLED
    : requestedState;
  if (state === APPLICATION_POLICY_STATES.ENABLED && capability?.automatic !== true) {
    return { automatic: APPLICATION_POLICY_STATES.DISABLED };
  }

  return { automatic: state };
}

/**
 * Normalize and validate all provider sources against the loaded provider capabilities.
 * Unknown provider ids use the conservative unsupported capability.
 *
 * @param {unknown} sources
 * @param {boolean|null|undefined} legacyAutoSendInquiry
 * @param {{legacyPrecedence?: boolean}} [options]
 * @returns {Promise<Array<object>>}
 */
export async function normalizeJobProviders(sources, legacyAutoSendInquiry = null, options = {}) {
  if (!Array.isArray(sources)) return [];

  const providers = await getProviders();
  const capabilitiesById = new Map(
    providers.map((provider) => [
      provider.metaInformation?.id,
      provider.metaInformation?.capabilities?.application ?? UNSUPPORTED_APPLICATION_CAPABILITIES,
    ]),
  );

  return sources.map((source) => {
    const value = source && typeof source === 'object' ? source : {};
    const capability = capabilitiesById.get(value.id) ?? UNSUPPORTED_APPLICATION_CAPABILITIES;
    const policyInput = value.applicationPolicy;
    const explicit = policyInput != null && hasOwn(policyInput, 'automatic');
    const normalizedSource = Object.fromEntries(
      PROVIDER_SOURCE_FIELDS.filter((field) => hasOwn(value, field)).map((field) => [field, value[field]]),
    );
    return {
      ...normalizedSource,
      applicationPolicy: normalizeApplicationPolicy(policyInput, capability, legacyAutoSendInquiry, {
        explicit,
        legacyPrecedence: options.legacyPrecedence,
      }),
    };
  });
}
