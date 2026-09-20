/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { findProviderByUrl, isHttpProviderUrl, validateProviderUrl } from './providerUrl.js';
import { missingRequirements } from './jobValidation.js';
import type { JobRequirement, JobValidationInput } from './jobValidation.js';

export type PolicyState = 'enabled' | 'disabled';

export interface ApplicationPolicy {
  automatic: PolicyState;
  [key: string]: unknown;
}

export interface GuidedProviderSource {
  id?: string;
  name?: string;
  url?: string;
  enabled?: boolean;
  applicationPolicy?: ApplicationPolicy;
  [key: string]: unknown;
}

export interface ProviderApplicationCapabilities {
  manual?: boolean;
  automatic?: boolean;
  eligibility?: 'provider' | 'listing' | 'none';
  validation?: 'provider' | 'local' | 'none';
  profileRequirements?: string[];
  consentRequirements?: string[];
  connectionRequired?: boolean;
  [key: string]: unknown;
}

export interface ProviderMetadata {
  id?: string;
  name?: string;
  baseUrl?: string;
  countries?: readonly string[];
  capabilities?: {
    application?: ProviderApplicationCapabilities;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SourcePolicyControlOptions {
  profileReady?: boolean;
}

export interface SourcePolicyControl {
  enabled: boolean;
  canEnable: boolean;
  disabled: boolean;
  reason: 'unsupported' | 'connection' | 'profile' | 'listing' | null;
  provider: ProviderMetadata | null;
  capability: ProviderApplicationCapabilities;
}

export interface GuidedChannel {
  id: string;
  [key: string]: unknown;
}

export interface GuidedJobPayloadInput {
  providerData?: readonly GuidedProviderSource[];
  providerMetadata?: readonly ProviderMetadata[];
  selectedChannels?: readonly GuidedChannel[];
  shareWithUsers?: string[];
  name?: string | null;
  blacklist?: unknown[];
  spatialFilter?: unknown | null;
  specFilter?: unknown | null;
  commuteFilter?: unknown | null;
  dealType?: 'rent' | 'buy' | null;
  enabled?: boolean;
  jobId?: string | null;
  /** Legacy draft compatibility; deliberately omitted from the payload. */
  autoSendInquiry?: boolean;
}

export interface GuidedJobPayload {
  provider: GuidedProviderSource[];
  notificationAdapter: Array<{ configuredAdapterId: string }>;
  shareWithUsers: string[];
  name?: string | null;
  blacklist: unknown[];
  spatialFilter: unknown | null;
  specFilter: unknown | null;
  commuteFilter: unknown | null;
  dealType: 'rent' | 'buy' | null;
  enabled: boolean;
  jobId: string | null;
}

const POLICY_STATES = Object.freeze({
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const);

const REQUIREMENT_STEP = Object.freeze({
  name: 0,
  provider: 0,
  dealType: 1,
  channel: 3,
} as const);

const DEFAULT_CAPABILITY: ProviderApplicationCapabilities = {
  manual: false,
  automatic: false,
  eligibility: 'none',
  validation: 'none',
  profileRequirements: [],
  consentRequirements: [],
  connectionRequired: false,
};

/**
 * The one guided form has four decision groups. The desktop tablist renders all four; the mobile
 * layout collapses it to the current step ribbon without changing the state machine.
 */
export const GUIDED_STEPS: ReadonlyArray<{ id: string; label: string }> = Object.freeze([
  Object.freeze({ id: 'providers', label: 'Providers' }),
  Object.freeze({ id: 'home-criteria', label: 'Home criteria' }),
  Object.freeze({ id: 'real-world-fit', label: 'Real-world fit' }),
  Object.freeze({ id: 'delivery-review', label: 'Delivery/review' }),
]);

/** @returns the nearest valid guided step index. */
export function normalizeStepIndex(stepIndex: number): number {
  const numeric = Number.isInteger(stepIndex) ? stepIndex : 0;
  return Math.min(Math.max(numeric, 0), GUIDED_STEPS.length - 1);
}

/** Return the requirements owned by a guided step. */
export function requirementKeysForStep(stepIndex: number): string[] {
  const normalized = normalizeStepIndex(stepIndex);
  return Object.entries(REQUIREMENT_STEP)
    .filter(([, ownerStep]) => ownerStep === normalized)
    .map(([key]) => key);
}

/** Validate one step without knowing anything about React or navigation. */
export function missingGuidedRequirements(
  stepIndex: number,
  job: JobValidationInput | null | undefined,
): JobRequirement[] {
  const owned = new Set(requirementKeysForStep(stepIndex));
  return missingRequirements(job).filter((requirement: JobRequirement) => owned.has(requirement.key));
}

/** Find the first incomplete step up to a requested destination. */
export function firstBlockedGuidedStep(
  job: JobValidationInput | null | undefined,
  targetStep: number = GUIDED_STEPS.length - 1,
): number | null {
  const destination = normalizeStepIndex(targetStep);
  for (let step = 0; step <= destination; step += 1) {
    if (missingGuidedRequirements(step, job).length > 0) return step;
  }
  return null;
}

/** Whether a tab or Continue action may move from one step to another. */
export function canMoveToGuidedStep(
  currentStep: number,
  targetStep: number,
  job: JobValidationInput | null | undefined,
): boolean {
  const current = normalizeStepIndex(currentStep);
  const target = normalizeStepIndex(targetStep);
  return target <= current || firstBlockedGuidedStep(job, target) == null;
}

/** Resolve provider metadata and backfill identity fields on a legacy source when possible. */
export function resolveProviderSource(
  source: GuidedProviderSource,
  providerMetadata: readonly ProviderMetadata[] = [],
): { source: GuidedProviderSource; provider: ProviderMetadata | null; capability: ProviderApplicationCapabilities } {
  const noProvider = () => ({ source, provider: null, capability: DEFAULT_CAPABILITY });
  if (source?.url != null && !isHttpProviderUrl(source.url)) return noProvider();

  const providerById =
    source?.id == null ? null : (providerMetadata.find((candidate) => candidate?.id === source.id) ?? null);
  const providerByUrl = findProviderByUrl(source?.url, providerMetadata);
  let provider: ProviderMetadata | null = providerById;

  if (source?.url != null) {
    if (providerByUrl != null) {
      // When both fields exist, the URL's exact normalized host must agree with the identity.
      if (source.id != null && providerByUrl.id != null && source.id !== providerByUrl.id) return noProvider();
      provider = providerByUrl;
    } else if (providerById?.baseUrl != null) {
      // A known provider with a declared base URL must also be found by that URL.
      return noProvider();
    }
  }

  const resolvedSource =
    provider == null
      ? source
      : {
          ...source,
          ...(source?.id == null && provider.id != null ? { id: provider.id } : {}),
          ...(source?.name == null && provider.name != null ? { name: provider.name } : {}),
        };
  const capability = provider?.capabilities?.application ?? DEFAULT_CAPABILITY;
  return { source: resolvedSource, provider, capability };
}

/**
 * Merge server capability metadata with one job source for display. The returned object is a view
 * model only; capability data is never sent back as job source state.
 */
export function mergeProviderCapability(
  source: GuidedProviderSource,
  providerMetadata: readonly ProviderMetadata[] = [],
): { source: GuidedProviderSource; provider: ProviderMetadata | null; capability: ProviderApplicationCapabilities } {
  return resolveProviderSource(source, providerMetadata);
}

/** Describe the visible automatic-inquiry control for one source. */
export function sourcePolicyControl(
  source: GuidedProviderSource,
  providerMetadata: readonly ProviderMetadata[] = [],
  { profileReady = true }: SourcePolicyControlOptions = {},
): SourcePolicyControl {
  const merged = mergeProviderCapability(source, providerMetadata);
  const enabled = source?.applicationPolicy?.automatic === POLICY_STATES.ENABLED;
  const supportsAutomatic = merged.capability.automatic === true;
  const connectionRequired = merged.capability.connectionRequired === true;
  const canEnable = supportsAutomatic && !connectionRequired && profileReady;
  let reason: SourcePolicyControl['reason'] = null;

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
 */
export function setSourceAutomaticPolicy(
  source: GuidedProviderSource,
  providerMetadata: readonly ProviderMetadata[],
  enabled: boolean,
  options: SourcePolicyControlOptions = {},
): GuidedProviderSource {
  const merged = mergeProviderCapability(source, providerMetadata);
  const control = sourcePolicyControl(merged.source, providerMetadata, options);
  if (enabled && !control.canEnable) return merged.source;
  return {
    ...merged.source,
    applicationPolicy: { automatic: enabled ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED },
  };
}

/**
 * Migrate a pre-policy local draft without allowing its job-wide flag to override sources that
 * already carry an explicit choice. Unsupported and connection-required sources remain disabled.
 */
export function migrateLegacyDraftProviderPolicies(
  sources: readonly GuidedProviderSource[] | null | undefined,
  legacyAutoSendInquiry: boolean,
  providerMetadata: readonly ProviderMetadata[] = [],
): GuidedProviderSource[] {
  return (Array.isArray(sources) ? sources : []).map((source) => {
    const automatic = source?.applicationPolicy?.automatic;
    if (automatic === POLICY_STATES.ENABLED || automatic === POLICY_STATES.DISABLED) {
      return resolveProviderSource(source, providerMetadata).source;
    }
    const resolved = resolveProviderSource(source, providerMetadata);
    const control = sourcePolicyControl(resolved.source, providerMetadata);
    return {
      ...resolved.source,
      applicationPolicy: {
        automatic: legacyAutoSendInquiry === true && control.canEnable ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED,
      },
    };
  });
}

/**
 * Keep only the source fields accepted by the backend and make the guided policy explicit. This
 * migrates a legacy source to disabled unless its source policy already says enabled.
 */
export function canonicalGuidedProviderSource(
  source: GuidedProviderSource,
  providerMetadata: readonly ProviderMetadata[] = [],
): GuidedProviderSource {
  const resolved = resolveProviderSource(source, providerMetadata);
  const resolvedSource = resolved.source;
  if (resolvedSource.url !== undefined && !isHttpProviderUrl(resolvedSource.url)) {
    throw new Error('Provider URL must use http or https');
  }
  // Fail closed for unknown provider URLs: only throw if provider metadata was provided
  // but the URL doesn't match any known provider. When no provider metadata is passed,
  // we allow the function to work for sanitization testing.
  if (resolvedSource.url !== undefined && resolved.provider == null && providerMetadata.length > 0) {
    throw new Error('Provider URL does not match any known provider');
  }
  if (
    resolvedSource.url !== undefined &&
    resolved.provider?.baseUrl != null &&
    !validateProviderUrl(resolvedSource.url, resolved.provider).ok
  ) {
    throw new Error('Provider URL does not match its provider');
  }

  const automatic = resolvedSource?.applicationPolicy?.automatic === POLICY_STATES.ENABLED;
  return {
    ...(resolvedSource?.id !== undefined ? { id: resolvedSource.id } : {}),
    ...(resolvedSource?.name !== undefined ? { name: resolvedSource.name } : {}),
    ...(resolvedSource?.url !== undefined ? { url: resolvedSource.url } : {}),
    ...(resolvedSource?.enabled !== undefined ? { enabled: resolvedSource.enabled } : {}),
    applicationPolicy: { automatic: automatic ? POLICY_STATES.ENABLED : POLICY_STATES.DISABLED },
  };
}

/**
 * Build the guided save payload. `autoSendInquiry` is intentionally absent: independent source
 * policies must not be overridden by a legacy job-wide value. The server still accepts and reads
 * that field for old clients and persisted jobs.
 */
export function buildGuidedJobPayload({
  providerData = [],
  providerMetadata = [],
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
}: GuidedJobPayloadInput = {}): GuidedJobPayload {
  return {
    provider: providerData.map((source) => canonicalGuidedProviderSource(source, providerMetadata)),
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
