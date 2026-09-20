/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Jobs that are not doing what their owner thinks they are doing.
 *
 * The dashboard reports totals, and a total is exactly the wrong shape for this: a job switched off
 * three weeks ago, or one that notifies nobody because its only channel was detached, disappears
 * into a count of four jobs and keeps quietly not working. Nothing on the page ever said so.
 *
 * Everything here is read from job data the app has already loaded. No new endpoint, and nothing
 * that needs a per-job run history the client does not have.
 */

export type AttentionReason = 'noChannel' | 'paused' | 'nothingFound';

/** Why a job was flagged. */
export const ATTENTION_REASONS = Object.freeze({
  NO_CHANNEL: 'noChannel',
  PAUSED: 'paused',
  NOTHING_FOUND: 'nothingFound',
} as const);

/** Most worth saying first. */
const SEVERITY: readonly AttentionReason[] = [
  ATTENTION_REASONS.NO_CHANNEL,
  ATTENTION_REASONS.PAUSED,
  ATTENTION_REASONS.NOTHING_FOUND,
];

/** How many to name before summarising the rest. */
export const ATTENTION_LIMIT = 4;

export interface AttentionOptions {
  lastRun?: number | null;
}

export interface AttentionEntry {
  id: string;
  name: string;
  reason: AttentionReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The one thing most worth saying about a job, or null when there is nothing to say. */
function reasonFor(job: unknown, hasRunOnce: boolean): AttentionReason | null {
  if (!isRecord(job)) {
    return null;
  }
  if (!Array.isArray(job.notificationAdapter) || job.notificationAdapter.length === 0) {
    return ATTENTION_REASONS.NO_CHANNEL;
  }
  if (job.enabled === false) {
    return ATTENTION_REASONS.PAUSED;
  }
  // Only once a search has actually happened. A job created a minute ago has found nothing yet
  // because nothing has run, and saying so would be a complaint about the clock.
  if (hasRunOnce && (typeof job.numberOfFoundListings !== 'number' || job.numberOfFoundListings === 0)) {
    return ATTENTION_REASONS.NOTHING_FOUND;
  }
  return null;
}

/** Which jobs want looking at. */
export function findJobsNeedingAttention(jobs: unknown, options: AttentionOptions = {}): AttentionEntry[] {
  return allJobsNeedingAttention(jobs, options).slice(0, ATTENTION_LIMIT);
}

/** The same, uncapped. */
export function allJobsNeedingAttention(jobs: unknown, options: AttentionOptions = {}): AttentionEntry[] {
  if (!Array.isArray(jobs)) {
    return [];
  }
  const hasRunOnce = options.lastRun != null && options.lastRun !== 0;

  return jobs
    .map((job): AttentionEntry | null => {
      if (!isRecord(job) || typeof job.id !== 'string') {
        return null;
      }
      const name = typeof job.name === 'string' ? job.name : '';
      const reason = reasonFor(job, hasRunOnce);
      return reason == null ? null : { id: job.id, name, reason };
    })
    .filter((entry): entry is AttentionEntry => entry != null)
    .sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason));
}

/** How many jobs want looking at, including the ones the list does not name. */
export function countJobsNeedingAttention(jobs: unknown, options?: AttentionOptions): number {
  return allJobsNeedingAttention(jobs, options).length;
}
