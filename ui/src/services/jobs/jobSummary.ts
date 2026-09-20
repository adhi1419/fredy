/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** What a job's optional settings add up to, in a line. */

import { countCommuteLimits } from './commuteFilter.js';

export interface JobSummarySpecFilter {
  maxPrice?: number | null;
  minSize?: number | null;
  minRooms?: number | null;
  [key: string]: unknown;
}

export type JobSummaryTranslator = (key: string, vars?: Record<string, string | number>) => string;

export interface JobSummaryContext {
  t: JobSummaryTranslator;
  formatPrice: (value: number) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Describe the refinements a job carries. */
export function describeJobRefinements(job: unknown, { t, formatPrice }: JobSummaryContext): string[] {
  const record = isRecord(job) ? job : null;
  const spec = isRecord(record?.specFilter) ? record.specFilter : {};
  const parts: string[] = [];

  // Ordered as the controls are: what it must cost and be, what to leave out, where, who else sees
  // it, and whether it runs at all.
  if (typeof spec.maxPrice === 'number') {
    parts.push(t('jobs.mutation.summaryMaxPrice', { value: formatPrice(spec.maxPrice) }));
  }
  if (typeof spec.minSize === 'number') {
    parts.push(t('jobs.mutation.summaryMinSize', { value: spec.minSize }));
  }
  if (typeof spec.minRooms === 'number') {
    parts.push(t('jobs.mutation.summaryMinRooms', { value: spec.minRooms }));
  }
  if (Array.isArray(record?.blacklist) && record.blacklist.length > 0) {
    parts.push(t('jobs.mutation.summaryBlacklist', { count: record.blacklist.length }));
  }
  if (record?.spatialFilter != null) {
    parts.push(t('jobs.mutation.summaryArea'));
  }
  // The shortest true thing about it. Naming every address and its limit would be longer than the
  // rest of the line put together, and the section is one click away for the detail.
  const commuteFilter = record?.commuteFilter;
  const commuteLimits =
    isRecord(commuteFilter) && (commuteFilter.limits == null || isRecord(commuteFilter.limits))
      ? countCommuteLimits(commuteFilter as { limits?: Record<string, number> })
      : 0;
  if (commuteLimits > 0) {
    parts.push(t('jobs.mutation.summaryCommute', { count: commuteLimits }));
  }
  if (record?.autoSendInquiry === true) {
    parts.push(t('jobs.mutation.summaryAutoSendInquiry'));
  }
  if (Array.isArray(record?.shareWithUsers) && record.shareWithUsers.length > 0) {
    parts.push(t('jobs.mutation.summaryShared', { count: record.shareWithUsers.length }));
  }
  // Only worth saying when it is off. A job that runs is the normal case and does not need
  // announcing; a job that never will is the thing someone would otherwise not notice.
  if (record?.enabled === false) {
    parts.push(t('jobs.mutation.summaryPaused'));
  }
  return parts;
}

/** The same, as one line ready to sit in a section header. */
export function summariseJobRefinements(job: unknown, context: JobSummaryContext): string {
  const parts = describeJobRefinements(job, context);
  return parts.length === 0 ? context.t('jobs.mutation.refineEmpty') : parts.join(' · ');
}
