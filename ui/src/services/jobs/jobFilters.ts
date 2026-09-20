/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** What the jobs page is filtered by, and how to say it out loud. */

export interface JobFilterValues {
  active: boolean | null;
}

export type JobFilterKey = keyof JobFilterValues;
export type JobFilterPatch = Partial<JobFilterValues> & Record<string, unknown>;
export type JobFilterTranslator = (key: string, vars?: Record<string, string | number>) => string;

/** The value of each filter that means "do not filter by this". */
export const NEUTRAL: JobFilterValues = {
  active: null,
};

/** The filters, in the order they are shown. */
export const FILTER_KEYS: readonly JobFilterKey[] = ['active'];

/** Whether a filter is doing something. */
export function isActiveFilter(key: string, values: Readonly<JobFilterValues>): boolean {
  const value = key === 'active' ? values.active : undefined;
  const neutral = key === 'active' ? NEUTRAL.active : undefined;
  return value !== neutral;
}

/** How many filters are on. */
export function countActiveFilters(values: Readonly<JobFilterValues>): number {
  return FILTER_KEYS.filter((key) => isActiveFilter(key, values)).length;
}

/** The URL patch for switching one filter off. */
export function clearFilter(key: string): JobFilterPatch {
  return { [key]: key === 'active' ? NEUTRAL.active : undefined, page: 1 };
}

/** The patch for switching every filter off. */
export function clearAllFilters(): JobFilterPatch {
  return { ...NEUTRAL, page: 1 };
}

/** A named list of the filters currently on, ready to render as chips. */
export function describeActiveFilters(
  values: Readonly<JobFilterValues>,
  { t }: { t: JobFilterTranslator },
): Array<{ key: JobFilterKey; label: string }> {
  const labels: Record<JobFilterKey, () => string> = {
    active: () => (values.active === true ? t('jobs.filterActive') : t('jobs.filterInactive')),
  };

  return FILTER_KEYS.filter((key) => isActiveFilter(key, values)).map((key) => ({
    key,
    label: labels[key](),
  }));
}
