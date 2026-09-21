/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The pure rule behind the one-week auto-archive sweep: does a listing's age and lifecycle state
 * mean the job run should move it to Archived? Kept free of Firestore and of `Date.now()` so the
 * boundary is a decision a test pins with two numbers rather than a behaviour it has to provoke.
 *
 * The boundary is strict: a listing is stale only once its age is *strictly greater* than one week.
 * At exactly `7 * 24 h` it is not yet stale — which is the same instant the card still reads "Last
 * week" (see {@link relativeListingAge}) — so the two surfaces never disagree about the edge.
 *
 * Already-archived listings are skipped: archiving is a one-way, once-only transition here, so a
 * second sweep over rows the first one moved is a no-op and the run stays idempotent. A missing or
 * unparseable `createdAt` is never archived — the sweep must not act on a listing whose age it
 * cannot establish.
 */

/** One week in milliseconds — the exact age boundary the sweep and the "Last week" card share. */
export const STALE_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000;

/** The canonical lifecycle state a stale listing is moved into. */
export const ARCHIVED_STATE = 'archived';

/**
 * Whether a listing should be auto-archived by the current job run.
 *
 * @param {{ createdAt?: number|string|null, lifecycleState?: string|null }} listing
 *   `createdAt` is the stored epoch-millis creation time; `lifecycleState` is the canonical
 *   lifecycle state already resolved from the row.
 * @param {{ now?: number }} [options] Reference time (epoch millis); defaults to the wall clock.
 * @returns {boolean} True only when the listing is not already archived and is strictly older than
 *   one week.
 */
export function isListingStaleForArchive({ createdAt, lifecycleState } = {}, { now = Date.now() } = {}) {
  if (lifecycleState === ARCHIVED_STATE) return false;

  if (createdAt == null || createdAt === '') return false;
  const created = typeof createdAt === 'number' ? createdAt : Number(createdAt);
  if (!Number.isFinite(created)) return false;

  return now - created > STALE_ARCHIVE_MS;
}
