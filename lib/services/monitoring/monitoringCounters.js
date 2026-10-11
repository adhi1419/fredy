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

/** The compact application outcome values exposed by admin Monitoring. */
export const MONITORING_LISTING_OUTCOMES = Object.freeze([
  'provider-confirmed',
  'manual-applied',
  'retryable',
  'terminal',
  'unknown',
  'not-attempted',
  'stored-only',
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
const accumulatorByCounters = new WeakMap();

/** @returns {Record<(typeof MONITORING_COUNTER_FIELDS)[number], number>} */
export function emptyMonitoringCounters() {
  return Object.fromEntries(MONITORING_COUNTER_FIELDS.map((field) => [field, 0]));
}

/**
 * Create one provider-run accumulator. Its public shape is deliberately normal and acyclic;
 * decision recording also accepts its `counters` member for compatibility with existing callers.
 *
 * @returns {{counters:Object, listingOutcomes:Map, unscopedCounters:Object}}
 */
export function createMonitoringAccumulator() {
  const counters = emptyMonitoringCounters();
  const accumulator = {
    counters,
    listingOutcomes: new Map(),
    unscopedCounters: emptyMonitoringCounters(),
  };
  accumulatorByCounters.set(counters, accumulator);
  return accumulator;
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

function accumulatorFor(value) {
  if (value?.counters && value?.listingOutcomes instanceof Map) return value;
  return value != null && typeof value === 'object' ? (accumulatorByCounters.get(value) ?? null) : null;
}

function recordCounter(target, event) {
  if (target == null) return;
  if (event?.decision === 'stored') {
    target.newListings += 1;
    return;
  }
  if (event?.decision === 'manual-applied' || event?.outcome === 'manual-applied') {
    target.manualApplied += 1;
    return;
  }
  if (event?.decision === 'sent' && event?.status === 'sent') {
    target.providerConfirmed += 1;
    return;
  }
  if (event?.decision === 'failed') {
    if (event?.status === 'failed') target.retryableFailures += 1;
    else if (event?.status === 'rejected') target.terminalFailures += 1;
    else target.unknownFailures += 1;
    return;
  }
  if (event?.flow === 'new' && event?.decision === 'skipped' && NOT_ATTEMPTED_REASONS.has(event?.reason)) {
    target.notAttempted += 1;
  }
}

function applicationOutcomeFor(event) {
  if (event?.outcome === 'manual-applied' || event?.decision === 'manual-applied') return 'manual-applied';
  if (event?.decision === 'sent' && event?.status === 'sent') return 'provider-confirmed';
  if (event?.decision === 'failed') {
    if (event?.status === 'failed') return 'retryable';
    if (event?.status === 'rejected') return 'terminal';
    return 'unknown';
  }
  if (event?.flow === 'new' && event?.decision === 'skipped' && NOT_ATTEMPTED_REASONS.has(event?.reason)) {
    return 'not-attempted';
  }
  return null;
}

function happenedAtFor(event, explicitHappenedAt) {
  const explicitTimestamp = Number(explicitHappenedAt);
  if (Number.isFinite(explicitTimestamp)) return explicitTimestamp;
  if (event?.happenedAt == null) return Date.now();
  const timestamp = Number(event.happenedAt);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

/**
 * Classify one privacy-safe listing decision into the approved Monitoring funnel. Direct counter
 * callers retain the original event-by-event behavior; accumulator callers additionally retain one
 * bounded, privacy-safe record per listing for finalization.
 * Repeated repair skips that are not an application outcome are deliberately ignored.
 *
 * @param {Object|null} counters Mutable run-local counters, an accumulator, or null when disabled.
 * @param {{listingId?:string, flow?:string, decision?:string, reason?:string, status?:string|null, outcome?:string, happenedAt?:number}} event
 * @param {number} [explicitHappenedAt] Optional timestamp supplied by a historical event reader.
 */
export function recordListingDecisionMetric(counters, event, explicitHappenedAt) {
  if (counters == null) return;
  const accumulator = accumulatorFor(counters);
  const target = accumulator?.counters ?? counters;
  recordCounter(target, event);
  if (accumulator == null || typeof event?.listingId !== 'string' || event.listingId.length === 0) {
    if (accumulator != null) recordCounter(accumulator.unscopedCounters, event);
    return;
  }

  const outcome = applicationOutcomeFor(event);
  if (event.decision !== 'stored' && outcome == null) return;
  const happenedAt = happenedAtFor(event, explicitHappenedAt);
  const current = accumulator.listingOutcomes.get(event.listingId) ?? {
    listingId: event.listingId,
    happenedAt,
    stored: false,
    outcome: null,
    reason: null,
  };
  current.happenedAt = happenedAt;
  if (event.decision === 'stored') {
    current.stored = true;
    current.reason ??= event.reason ?? null;
  }
  if (outcome != null) {
    current.outcome = outcome;
    current.reason = event.reason ?? null;
  }
  accumulator.listingOutcomes.set(event.listingId, current);
}

/**
 * Collapse repeated decisions for each listing and rewrite application counters to the final outcome
 * only. Storage is independent: a stored listing remains counted even when its final application
 * outcome is terminal or retryable.
 *
 * @param {Object|null} accumulator
 * @returns {Array<{listingId:string, happenedAt:number, stored:boolean, outcome:string, reason:string|null}>}
 */
export function finalizeMonitoringListingOutcomes(accumulator) {
  if (accumulator == null || !(accumulator.listingOutcomes instanceof Map)) return [];

  const counters = accumulator.counters;
  const unscoped = normalizeMonitoringCounters(accumulator.unscopedCounters);
  const finalized = emptyMonitoringCounters();
  finalized.newListings = Math.max(0, Math.floor(Number(counters.newListings) || 0));
  finalized.manualApplied = unscoped.manualApplied;
  finalized.providerConfirmed = unscoped.providerConfirmed;
  finalized.retryableFailures = unscoped.retryableFailures;
  finalized.terminalFailures = unscoped.terminalFailures;
  finalized.unknownFailures = unscoped.unknownFailures;
  finalized.notAttempted = unscoped.notAttempted;

  const outcomes = [];
  for (const value of accumulator.listingOutcomes.values()) {
    if (!value.stored && value.outcome == null) continue;
    const outcome = value.outcome ?? 'stored-only';
    outcomes.push({
      listingId: value.listingId,
      happenedAt: value.happenedAt,
      stored: value.stored === true,
      outcome,
      reason: value.reason ?? null,
    });
    if (outcome === 'provider-confirmed') finalized.providerConfirmed += 1;
    else if (outcome === 'manual-applied') finalized.manualApplied += 1;
    else if (outcome === 'retryable') finalized.retryableFailures += 1;
    else if (outcome === 'terminal') finalized.terminalFailures += 1;
    else if (outcome === 'unknown') finalized.unknownFailures += 1;
    else if (outcome === 'not-attempted') finalized.notAttempted += 1;
  }
  outcomes.sort((a, b) => a.listingId.localeCompare(b.listingId));
  for (const field of MONITORING_COUNTER_FIELDS) counters[field] = finalized[field];
  return outcomes;
}
