/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The pure rule behind the auto-archive sweep: does a listing's age and lifecycle state mean the
 * job run should move it to Archived? Kept free of Firestore and of `Date.now()` so the boundary is
 * a decision a test pins with two numbers rather than a behaviour it has to provoke.
 *
 * The window depends on the lifecycle state, and each is measured from the moment the listing
 * entered that state, not from a single creation time:
 *
 * | state     | window  | measured from                                                  |
 * |-----------|---------|----------------------------------------------------------------|
 * | `new`     | 14 days | `createdAt`                                                    |
 * | `applied` | 30 days | `lifecycle.appliedAt` → `lifecycle.changedAt` → `createdAt`    |
 * | `viewed`  | 45 days | `lifecycle.viewedAt`  → `lifecycle.changedAt` → `createdAt`    |
 * | `archived`| —       | never touched                                                  |
 *
 * The fallback chain exists because an older row may carry a lifecycle state without the matching
 * per-state timestamp; it then falls back to `changedAt` (when the state last moved) and finally to
 * `createdAt`, so the reference time is always the best evidence available of when the state began.
 *
 * The boundary is strict: a listing is stale only once its age is *strictly greater* than its
 * window. At exactly the window it is not yet stale.
 *
 * Already-archived listings are skipped: archiving is a one-way, once-only transition here, so a
 * second sweep over rows the first one moved is a no-op and the run stays idempotent. A missing or
 * unparseable reference timestamp is never archived — the sweep must not act on a listing whose age
 * it cannot establish.
 *
 * The Home card's "Last week" bucket (see {@link relativeListingAge} in
 * `ui/src/services/home/listingAge.ts`) is a separate, coarser display concern and no longer shares
 * this boundary.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-lifecycle-state auto-archive windows, in milliseconds. A listing in each state is archived
 * once it is strictly older than the window, measured from when it entered that state.
 */
export const AUTO_ARCHIVE_WINDOWS_MS = Object.freeze({
  new: 14 * DAY_MS,
  applied: 30 * DAY_MS,
  viewed: 45 * DAY_MS,
});

/** The smallest window (14 days) — the Firestore prefilter uses it as a safe, broad cutoff. */
export const MIN_AUTO_ARCHIVE_MS = Math.min(...Object.values(AUTO_ARCHIVE_WINDOWS_MS));

/** The canonical lifecycle state a stale listing is moved into. */
export const ARCHIVED_STATE = 'archived';

/**
 * The resolved lifecycle shape {@link lifecycleFromData} returns.
 *
 * @typedef {{
 *   state: string,
 *   source: string|null,
 *   changedAt: number|string|null,
 *   changedBy: string|null,
 *   appliedAt: number|string|null,
 *   viewedAt: number|string|null,
 * }} ResolvedLifecycle
 */

/** Coerce a stored epoch-millis value (number or numeric string) to a finite number, or null. */
function toEpochMillis(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The reference time the window for `lifecycle.state` is measured from, or null when none can be
 * parsed (in which case the listing is never archived).
 *
 * @param {number|string|null|undefined} createdAt Stored epoch-millis creation time.
 * @param {ResolvedLifecycle} lifecycle Resolved lifecycle object.
 * @returns {number|null}
 */
function referenceTimeFor(createdAt, lifecycle) {
  const created = toEpochMillis(createdAt);
  if (lifecycle.state === 'applied') {
    return toEpochMillis(lifecycle.appliedAt) ?? toEpochMillis(lifecycle.changedAt) ?? created;
  }
  if (lifecycle.state === 'viewed') {
    return toEpochMillis(lifecycle.viewedAt) ?? toEpochMillis(lifecycle.changedAt) ?? created;
  }
  // 'new' (and any other active state) is measured from createdAt.
  return created;
}

/**
 * Whether a listing should be auto-archived by the current job run.
 *
 * @param {{ createdAt?: number|string|null, lifecycle?: ResolvedLifecycle }} listing
 *   `createdAt` is the stored epoch-millis creation time; `lifecycle` is the resolved lifecycle
 *   object (from `lifecycleFromData`) carrying `state`, `changedAt`, `appliedAt` and `viewedAt`.
 * @param {{ now?: number }} [options] Reference time (epoch millis); defaults to the wall clock.
 * @returns {boolean} True only when the listing is not already archived, its state has a defined
 *   window, its reference timestamp parses, and it is strictly older than that window.
 */
export function isListingStaleForArchive({ createdAt, lifecycle } = {}, { now = Date.now() } = {}) {
  const resolved = lifecycle ?? {
    state: 'new',
    source: null,
    changedAt: null,
    changedBy: null,
    appliedAt: null,
    viewedAt: null,
  };
  if (resolved.state === ARCHIVED_STATE) return false;

  const window = AUTO_ARCHIVE_WINDOWS_MS[resolved.state];
  if (window == null) return false;

  const reference = referenceTimeFor(createdAt, resolved);
  if (reference == null) return false;

  return now - reference > window;
}
