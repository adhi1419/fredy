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
