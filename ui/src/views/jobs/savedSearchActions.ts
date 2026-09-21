/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { Job } from '../../services/state/jobsState';

export type SavedSearchActionKind = 'run' | 'resume' | 'running' | 'readOnly';
export type SavedSearchActionTranslation = (key: string, variables?: Record<string, string | number>) => string;

export interface SavedSearchDirectAction {
  kind: SavedSearchActionKind;
  label: string;
  disabled: boolean;
}

export function getSavedSearchDirectAction(
  job: Pick<Job, 'enabled' | 'running' | 'isOnlyShared'>,
  t: SavedSearchActionTranslation,
): SavedSearchDirectAction {
  if (job.isOnlyShared === true) {
    return { kind: 'readOnly', label: t('jobs.index.readOnlyAction'), disabled: true };
  }
  if (job.running === true) {
    return { kind: 'running', label: t('jobs.index.running'), disabled: true };
  }
  if (job.enabled === true) {
    return { kind: 'run', label: t('jobs.index.run'), disabled: false };
  }
  return { kind: 'resume', label: t('jobs.index.resume'), disabled: false };
}

export function shouldShowPause(job: Pick<Job, 'enabled' | 'isOnlyShared'>): boolean {
  return job.enabled === true && job.isOnlyShared !== true;
}

/** The three run-health states a saved-search row can surface, in priority order. */
export type SavedSearchHealthKind = 'review' | 'ready' | 'idle';

export interface SavedSearchHealth {
  kind: SavedSearchHealthKind;
  /** Number of listings awaiting manual review (only meaningful for `review`). */
  reviewCount: number;
}

/**
 * Resolve the run-health line for a saved-search row.
 *
 * The idempotent run contract never retries an unknown external outcome blindly, so a search that
 * carries unknown inquiry outcomes surfaces a warning ("Review N unknown inquiry") instead of
 * "Ready". `manualReviewCount` is an optional aggregate the jobs API may not send yet — when it is
 * absent (null/undefined) or zero we never fabricate a value and fall back to the existing
 * ready/never-run health derived from `lastRunAt`.
 */
export function resolveSavedSearchHealth(job: Pick<Job, 'lastRunAt' | 'manualReviewCount'>): SavedSearchHealth {
  const reviewCount = typeof job.manualReviewCount === 'number' ? job.manualReviewCount : 0;
  if (reviewCount > 0) {
    return { kind: 'review', reviewCount };
  }
  if (job.lastRunAt != null) {
    return { kind: 'ready', reviewCount: 0 };
  }
  return { kind: 'idle', reviewCount: 0 };
}
