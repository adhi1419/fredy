/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { supportsInquirySending } from '../inquiries/sendInquiry.js';
import { normalizeApplicationCapabilities } from './capabilities.js';

const ENABLED_POLICY_STATES = new Set(['enabled', true]);

/**
 * Resolve whether automatic inquiry delivery is eligible for one provider/listing execution.
 *
 * The caller passes the exact source from the execution loop. A job may contain several URLs for
 * the same provider, so looking a source up by provider id would attach every run to the first
 * source's policy. An explicit source policy is authoritative; only a source with no policy at all
 * uses the legacy job-level flag. Capability and listing support are independent gates, and
 * malformed values fail closed.
 *
 * @param {{source?: object, legacyAutoSendInquiry?: boolean, providerId?: string, capability?: object, listing?: object}} params
 * @returns {boolean}
 */
export function resolveAutomaticInquiryPolicy({
  source,
  legacyAutoSendInquiry = false,
  providerId,
  capability,
  listing,
} = {}) {
  if (source == null || typeof source !== 'object' || typeof providerId !== 'string' || source.id !== providerId) {
    return false;
  }

  if (
    capability == null ||
    typeof capability !== 'object' ||
    capability.automatic !== true ||
    !['provider', 'listing'].includes(capability.eligibility)
  ) {
    return false;
  }
  const application = normalizeApplicationCapabilities(capability);
  if (application.automatic !== true) return false;

  const sourcePolicy = source.applicationPolicy;
  const hasSourcePolicy = Object.prototype.hasOwnProperty.call(source, 'applicationPolicy');
  const hasExplicitPolicy =
    hasSourcePolicy &&
    sourcePolicy != null &&
    typeof sourcePolicy === 'object' &&
    Object.prototype.hasOwnProperty.call(sourcePolicy, 'automatic');
  const automatic = hasSourcePolicy
    ? hasExplicitPolicy && ENABLED_POLICY_STATES.has(sourcePolicy.automatic)
    : legacyAutoSendInquiry === true;
  if (!automatic) return false;

  if (application.eligibility === 'provider') return true;
  if (application.eligibility !== 'listing') return false;
  return listing != null && supportsInquirySending(providerId, listing);
}
