/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Canonical user-visible listing lifecycle values. These are deliberately stable
 * lower-case wire/storage values; labels belong to the clients.
 */
export const LISTING_LIFECYCLE_STATES = Object.freeze(['new', 'applied', 'viewed', 'archived']);

const LEGACY_STATUS_TO_LIFECYCLE = Object.freeze({
  applied: 'applied',
  accepted: 'archived',
  rejected: 'archived',
});

const LIFECYCLE_TO_LEGACY_STATUS = Object.freeze({
  new: null,
  applied: 'applied',
  viewed: 'applied',
  archived: null,
});

/**
 * Read the old structured status field without losing malformed/unknown data.
 * @param {unknown} value
 * @returns {{status?: string, setAt?: number}|null}
 */
export function readLegacyStatus(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical lifecycle from a document, falling back to the legacy
 * status field during the compatibility window.
 * @param {Object} data
 * @returns {{state: string, source: string|null, changedAt: number|null, changedBy: string|null, appliedAt: number|null, viewedAt: number|null}}
 */
export function lifecycleFromData(data = {}) {
  const stored = data.lifecycle;
  if (stored && LISTING_LIFECYCLE_STATES.includes(stored.state)) {
    return {
      state: stored.state,
      source: stored.source ?? null,
      changedAt: stored.changedAt ?? null,
      changedBy: stored.changedBy ?? null,
      appliedAt: stored.appliedAt ?? null,
      viewedAt: stored.viewedAt ?? null,
    };
  }

  const legacy = readLegacyStatus(data.status);
  const legacyState = LEGACY_STATUS_TO_LIFECYCLE[legacy?.status];
  return {
    state: legacyState ?? 'new',
    source: legacyState == null ? null : 'legacy-status',
    changedAt: legacy?.setAt ?? null,
    changedBy: null,
    appliedAt: legacyState === 'applied' ? (legacy?.setAt ?? null) : null,
    viewedAt: null,
  };
}

/**
 * Apply a user lifecycle action. Legacy status names are accepted so old API
 * clients continue to work; accepted/rejected intentionally collapse to the
 * new archived state while their raw status remains available for compatibility.
 * @param {Object} current
 * @param {string|null} action
 * @param {{changedAt?: number, changedBy?: string|null, source?: string}} [options]
 */
export function transitionLifecycle(
  current,
  action,
  { changedAt = Date.now(), changedBy = null, source = 'manual' } = {},
) {
  const normalized = action == null ? 'new' : String(action).trim().toLowerCase();
  const state =
    normalized === 'reset' || normalized === 'restore' || normalized === 'new'
      ? 'new'
      : normalized === 'accepted' || normalized === 'rejected' || normalized === 'archive'
        ? 'archived'
        : normalized === 'viewing' || normalized === 'viewed'
          ? 'viewed'
          : normalized === 'applied'
            ? 'applied'
            : normalized === 'archived'
              ? 'archived'
              : null;
  if (!state) throw new Error(`Invalid listing lifecycle action: ${action}`);

  const previous = current && typeof current === 'object' ? current : {};
  return {
    state,
    source,
    changedAt,
    changedBy,
    appliedAt: state === 'applied' ? (previous.appliedAt ?? changedAt) : (previous.appliedAt ?? null),
    viewedAt: state === 'viewed' ? (previous.viewedAt ?? changedAt) : (previous.viewedAt ?? null),
  };
}

/**
 * Build the old JSON status projection. New lifecycle states that had no old
 * equivalent are represented conservatively rather than as accepted/rejected.
 */
export function legacyStatusPayload(state, action, changedAt = Date.now()) {
  const normalized = action == null ? null : String(action).trim().toLowerCase();
  if (normalized === 'accepted' || normalized === 'rejected') {
    return JSON.stringify({ status: normalized, setAt: changedAt });
  }
  const legacy = LIFECYCLE_TO_LEGACY_STATUS[state];
  return legacy == null ? null : JSON.stringify({ status: legacy, setAt: changedAt });
}

/**
 * Map the existing inquiry delivery status to internal application attempt
 * evidence. It is never a competing user-visible lifecycle state.
 */
export function attemptProjection(inquirySendStatus, fields = {}) {
  const state =
    inquirySendStatus === 'sent'
      ? 'confirmed'
      : inquirySendStatus === 'sending'
        ? 'sending'
        : inquirySendStatus === 'failed'
          ? 'failed'
          : inquirySendStatus === 'unknown'
            ? 'unknown'
            : 'none';
  return {
    state,
    startedAt: fields.startedAt ?? null,
    finishedAt: fields.finishedAt ?? null,
    requestId: fields.requestId ?? null,
    error: fields.error ?? null,
  };
}
