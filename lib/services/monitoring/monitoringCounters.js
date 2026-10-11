/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** The stable counter contract persisted in hourly monitoring rollups. */
export const MONITORING_COUNTER_FIELDS = Object.freeze([
  'newListings',
  'providerConfirmed',
  'manualApplied',
  'retryableFailures',
  'terminalFailures',
  'unknownFailures',
  'notAttempted',
]);

const NOT_ATTEMPTED_REASONS = new Set([
  'incomplete-applicant-profile',
  'provider-delivery-unsupported',
  'policy-or-provider-unsupported',
  'missing-inquiry-draft',
  'commute-over-budget',
  'commute-missing-travel-time',
  'commute-unmatched-address-limit',
  'automatic-policy-disabled',
  'missing-applicant-profile',
]);

/** @returns {Record<(typeof MONITORING_COUNTER_FIELDS)[number], number>} */
export function emptyMonitoringCounters() {
  return Object.fromEntries(MONITORING_COUNTER_FIELDS.map((field) => [field, 0]));
}

/**
 * Return a bounded non-negative integer counter object.
 * @param {Object|null|undefined} value
 */
export function normalizeMonitoringCounters(value) {
  const normalized = emptyMonitoringCounters();
  for (const field of MONITORING_COUNTER_FIELDS) {
    const number = Number(value?.[field]);
    normalized[field] = Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }
  return normalized;
}

/**
 * Add one counter object into another without replacing its identity.
 * @param {Object} target
 * @param {Object} source
 */
export function addMonitoringCounters(target, source) {
  const normalized = normalizeMonitoringCounters(source);
  for (const field of MONITORING_COUNTER_FIELDS) target[field] = (target[field] ?? 0) + normalized[field];
  return target;
}

/**
 * Classify one privacy-safe listing decision into the approved Monitoring funnel.
 * Repeated repair skips are deliberately not counted as new "not attempted" applications.
 *
 * @param {Object|null} counters Mutable run-local counters, or null when monitoring is disabled.
 * @param {{flow?:string, decision?:string, reason?:string, status?:string|null}} event
 */
export function recordListingDecisionMetric(counters, event) {
  if (counters == null) return;
  if (event?.decision === 'stored') {
    counters.newListings += 1;
    return;
  }
  if (event?.decision === 'sent' && event?.status === 'sent') {
    counters.providerConfirmed += 1;
    return;
  }
  if (event?.decision === 'failed') {
    if (event?.status === 'failed') counters.retryableFailures += 1;
    else if (event?.status === 'rejected') counters.terminalFailures += 1;
    else counters.unknownFailures += 1;
    return;
  }
  if (event?.flow === 'new' && event?.decision === 'skipped' && NOT_ATTEMPTED_REASONS.has(event?.reason)) {
    counters.notAttempted += 1;
  }
}
