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
 * Normalize one source policy. An explicit persisted source policy is authoritative. Missing policy
 * defaults to disabled, and explicit enables are rejected for unsupported providers.
 *
 * @param {unknown} input
 * @param {object} capability
 * @returns {ApplicationPolicy}
 */
export function normalizeApplicationPolicy(input, capability) {
  const explicit = hasOwn(input, 'automatic');
  const automatic = input?.automatic;
  let requestedState;

  if (automatic === APPLICATION_POLICY_STATES.ENABLED || automatic === true) {
    requestedState = APPLICATION_POLICY_STATES.ENABLED;
  } else if (automatic === APPLICATION_POLICY_STATES.DISABLED || automatic === false || !explicit) {
    requestedState = APPLICATION_POLICY_STATES.DISABLED;
  } else {
    throw new ApplicationPolicyValidationError('applicationPolicy.automatic must be either enabled or disabled.');
  }

  if (explicit && requestedState === APPLICATION_POLICY_STATES.ENABLED && capability?.automatic !== true) {
    throw new ApplicationPolicyValidationError('Automatic application is not supported by the selected provider.');
  }
  if (requestedState === APPLICATION_POLICY_STATES.ENABLED && capability?.automatic !== true) {
    return { automatic: APPLICATION_POLICY_STATES.DISABLED };
  }
  return { automatic: requestedState };
}

/**
 * Normalize and validate all provider sources against the loaded provider capabilities.
 * Unknown provider ids use the conservative unsupported capability.
 *
 * @param {unknown} sources
 * @returns {Promise<Array<object>>}
 */
export async function normalizeJobProviders(sources) {
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
    const normalizedSource = Object.fromEntries(
      PROVIDER_SOURCE_FIELDS.filter((field) => hasOwn(value, field)).map((field) => [field, value[field]]),
    );
    return {
      ...normalizedSource,
      applicationPolicy: normalizeApplicationPolicy(policyInput, capability),
    };
  });
}
