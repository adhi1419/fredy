/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { missingRequirements } from './jobValidation.js';

const POLICY_STATES = Object.freeze({
  ENABLED: 'enabled',
  DISABLED: 'disabled',
});

const REQUIREMENT_STEP = Object.freeze({
  name: 0,
  provider: 0,
  dealType: 1,
  channel: 3,
});

/**
 * The one guided form has four decision groups. The desktop tablist renders all four; the mobile
 * layout collapses it to the current step ribbon without changing the state machine.
 *
 * @type {ReadonlyArray<{id: string, label: string}>}
 */
export const GUIDED_STEPS = Object.freeze([
  Object.freeze({ id: 'providers', label: 'Providers' }),
  Object.freeze({ id: 'home-criteria', label: 'Home criteria' }),
  Object.freeze({ id: 'real-world-fit', label: 'Real-world fit' }),
  Object.freeze({ id: 'delivery-review', label: 'Delivery/review' }),
]);

/**
 * @param {number} stepIndex
 * @returns {number}
 */
export function normalizeStepIndex(stepIndex) {
  const numeric = Number.isInteger(stepIndex) ? stepIndex : 0;
  return Math.min(Math.max(numeric, 0), GUIDED_STEPS.length - 1);
}

/**
 * Return the requirements owned by a guided step.
 *
 * @param {number} stepIndex
 * @returns {string[]}
 */
export function requirementKeysForStep(stepIndex) {
  const normalized = normalizeStepIndex(stepIndex);
  return Object.entries(REQUIREMENT_STEP)
    .filter(([, ownerStep]) => ownerStep === normalized)
    .map(([key]) => key);
}

/**
 * Validate one step without knowing anything about React or navigation.
 *
 * @param {number} stepIndex
 * @param {Object|null|undefined} job
 * @returns {Array<{key: string, isMet: Function}>}
 */
export function missingGuidedRequirements(stepIndex, job) {
  const owned = new Set(requirementKeysForStep(stepIndex));
  return missingRequirements(job).filter((requirement) => owned.has(requirement.key));
}

/**
 * Find the first incomplete step up to a requested destination.
 *
 * @param {Object|null|undefined} job
 * @param {number} [targetStep]
 * @returns {number|null}
 */
export function firstBlockedGuidedStep(job, targetStep = GUIDED_STEPS.length - 1) {
  const destination = normalizeStepIndex(targetStep);
  for (let step = 0; step <= destination; step += 1) {
    if (missingGuidedRequirements(step, job).length > 0) return step;
  }
  return null;
}

/**
 * Whether a tab or Continue action may move from one step to another.
 *
 * @param {number} currentStep
 * @param {number} targetStep
 * @param {Object|null|undefined} job
 * @returns {boolean}
 */
export function canMoveToGuidedStep(currentStep, targetStep, job) {
  const current = normalizeStepIndex(currentStep);
  const target = normalizeStepIndex(targetStep);
  return target <= current || firstBlockedGuidedStep(job, target) == null;
}

/**
 * Merge server capability metadata with one job source for display. The returned object is a view
 * model only; capability data is never sent back as job source state.
 *
 * @param {Object} source
 * @param {Array<Object>} [providerMetadata]
 * @returns {{source: Object, provider: Object|null, capability: Object}}
 */
export function mergeProviderCapability(source, providerMetadata = []) {
  const provider = providerMetadata.find((candidate) => candidate?.id === source?.id) ?? null;
  const capability = provider?.capabilities?.application ?? {
    manual: false,
    automatic: false,
    eligibility: 'none',
    validation: 'none',
    profileRequirements: [],
    consentRequirements: [],
    connectionRequired: false,
  };
  return { source, provider, capability };
}

/**
 * Describe the visible automatic-inquiry control for one source.
 *
 * @param {Object} source
 * @param {Array<Object>} [providerMetadata]
 * @param {{profileReady?: boolean}} [options]
 * @returns {{enabled: boolean, canEnable: boolean, disabled: boolean, reason: string|null, provider: Object|null, capability: Object}}
 */
export function sourcePolicyControl(source, providerMetadata = [], { profileReady = true } = {}) {
  const merged = mergeProviderCapability(source, providerMetadata);
  const enabled = source?.applicationPolicy?.automatic === POLICY_STATES.ENABLED;
  const supportsAutomatic = merged.capability.automatic === true;
  const connectionRequired = merged.capability.connectionRequired === true;
  const canEnable = supportsAutomatic && !connectionRequired && profileReady;
  let reason = null;

  if (!supportsAutomatic) reason = 'unsupported';
  else if (connectionRequired) reason = 'connection';
  else if (!profileReady) reason = 'profile';
  else if (merged.capability.eligibility === 'listing') reason = 'listing';

  return {
    enabled,
    canEnable: enabled || canEnable,
    disabled: !enabled && !canEnable,
    reason,
    provider: merged.provider,
    capability: merged.capability,
  };
}

/**
 * Apply a source-local automatic policy without introducing capability metadata or credentials into
 * the job source. Unsupported and connection-required sources fail closed and remain unchanged.
 *
 * @param {Object} source
 * @param {Array<Object>} providerMetadata
 * @param {boolean} enabled
 * @param {{profileReady?: boolean}} [options]
 * @returns {Object}
 */
export function setSourceAutomaticPolicy(source, providerMetadata, enabled, options = {}) {
  const control = sourcePolicyControl(source, providerMetadata, options);
  if (enabled && !control.canEnable) return source;
  return {
    ...source,
    applicationPolicy: { automatic: enabled ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED },
  };
}

/**
 * Migrate a pre-policy local draft without allowing its job-wide flag to override sources that
 * already carry an explicit choice. Unsupported and connection-required sources remain disabled.
 *
 * @param {Array<Object>} sources
 * @param {boolean} legacyAutoSendInquiry
 * @param {Array<Object>} providerMetadata
 * @returns {Array<Object>}
 */
export function migrateLegacyDraftProviderPolicies(sources, legacyAutoSendInquiry, providerMetadata = []) {
  return (Array.isArray(sources) ? sources : []).map((source) => {
    const automatic = source?.applicationPolicy?.automatic;
    if (automatic === POLICY_STATES.ENABLED || automatic === POLICY_STATES.DISABLED) return source;
    const control = sourcePolicyControl(source, providerMetadata);
    return {
      ...source,
      applicationPolicy: {
        automatic: legacyAutoSendInquiry === true && control.canEnable ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED,
      },
    };
  });
}

/**
 * Keep only the source fields accepted by the backend and make the guided policy explicit. This
 * migrates a legacy source to disabled unless its source policy already says enabled.
 *
 * @param {Object} source
 * @returns {Object}
 */
export function canonicalGuidedProviderSource(source) {
  const automatic = source?.applicationPolicy?.automatic === POLICY_STATES.ENABLED;
  return {
    ...(source?.id !== undefined ? { id: source.id } : {}),
    ...(source?.name !== undefined ? { name: source.name } : {}),
    ...(source?.url !== undefined ? { url: source.url } : {}),
    ...(source?.enabled !== undefined ? { enabled: source.enabled } : {}),
    applicationPolicy: { automatic: automatic ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED },
  };
}

/**
 * Build the guided save payload. `autoSendInquiry` is intentionally absent: independent source
 * policies must not be overridden by a legacy job-wide value. The server still accepts and reads
 * that field for old clients and persisted jobs.
 *
 * @param {Object} values
 * @returns {Object}
 */
export function buildGuidedJobPayload({
  providerData = [],
  selectedChannels = [],
  shareWithUsers = [],
  name,
  blacklist = [],
  spatialFilter = null,
  specFilter = null,
  commuteFilter = null,
  dealType = null,
  enabled = true,
  jobId = null,
} = {}) {
  return {
    provider: providerData.map(canonicalGuidedProviderSource),
    notificationAdapter: selectedChannels.map((channel) => ({ configuredAdapterId: channel.id })),
    shareWithUsers,
    name,
    blacklist,
    spatialFilter,
    specFilter,
    commuteFilter,
    dealType,
    enabled,
    jobId,
  };
}

export { POLICY_STATES };
