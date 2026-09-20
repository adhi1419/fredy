/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { parseCommuteFilter } from '../../components/transit/travelTimeFormat.js';

/** Values carried by the listings URL state that are neutral when unset. */
export interface NeutralListingFilterValues {
  watch: boolean | null;
  job: string | null;
  active: boolean | null;
  provider: string | null;
  status: string | null;
  afford: string | null;
  commute: string | null;
  down: number | null;
  fiber: boolean | null;
  mtech: string | null;
  mop: string | null;
  hidden: boolean;
}

/** The complete URL state consumed by the listing filter helpers. */
export interface ListingFilterValues extends NeutralListingFilterValues {
  page: number;
  sort: string;
  dir: string;
  q: string | null;
}

/** A URL update returned by a filter control. Unknown keys remain supported for compatibility. */
export type ListingFilterPatch = Partial<ListingFilterValues> & Record<string, unknown>;

/** A filter key represented by the neutral filter state. */
export type ListingFilterKey = keyof NeutralListingFilterValues;

/** A filter key rendered as a chip; the mobile operator is coupled to `mtech`. */
export type VisibleListingFilterKey = Exclude<ListingFilterKey, 'mop'>;

/** A choice shown in a job or provider filter. */
export interface NamedFilterOption {
  id: string;
  name: string;
}

/** Provider metadata nested in a saved-search configuration. */
export interface ConfiguredProviderMetadata {
  id?: string;
  name?: string;
}

/** The job fields used when deriving configured providers. */
export interface ConfiguredJobMetadata {
  id: string;
  name?: string;
  provider?: ConfiguredProviderMetadata[];
}

/** Translation function required to render active-filter labels. */
export type ListingFilterTranslator = (key: string, vars?: Record<string, string | number>) => string;

/** Context needed to turn active URL values into labels. */
export interface DescribeListingFiltersContext {
  t: ListingFilterTranslator;
  jobs?: NamedFilterOption[];
  providers?: NamedFilterOption[];
}

/** The four states represented by the listings activity control. */
export type ListingShowValue = 'all' | 'true' | 'false' | 'hidden';

/**
 * The value of each filter that means "do not filter by this".
 *
 * Note that `active` is neutral at `null`, not at its URL default of `true`. The page opens showing
 * active listings only, which is a filter - a real one, hiding real rows - and pretending otherwise
 * would leave the user with no way to see that it is on.
 */
export const NEUTRAL: NeutralListingFilterValues = {
  watch: null,
  job: null,
  active: null,
  provider: null,
  status: null,
  afford: null,
  commute: null,
  down: null,
  fiber: null,
  mtech: null,
  mop: null,
  hidden: false,
};

/**
 * The filters, in the order they are shown.
 *
 * Written out rather than derived from `NEUTRAL`, because this is the reading order of the chip row
 * and the drawer - what the page is showing, then what has been done about it, then how well it
 * fits, then where it came from - and that should not be a side effect of how an object literal
 * happens to be typed.
 */
export const FILTER_KEYS: VisibleListingFilterKey[] = [
  'hidden',
  'active',
  'watch',
  'status',
  'afford',
  'commute',
  'down',
  'fiber',
  'mtech',
  'provider',
  'job',
];

/**
 * The mobile operator is not in `FILTER_KEYS` on purpose.
 *
 * It cannot filter anything on its own - the query needs a technology to turn the pair into a bit -
 * so counting it would report two filters where the user set one, and clearing the technology has
 * to take it along.
 */
export const MOBILE_OPERATOR_KEY = 'mop' as const;

/**
 * Whether a filter is doing something.
 *
 * Activity and the hidden view are one control wearing two keys: while hidden listings are shown,
 * `active` is forced to null and must not be counted as a second filter.
 */
export function isActiveFilter(key: string, values: Readonly<ListingFilterValues>): boolean {
  if (key === 'active' && values.hidden === true) {
    return false;
  }
  return valueForKey(values, key) !== neutralValueForKey(key);
}

/** How many filters are on. */
export function countActiveFilters(values: Readonly<ListingFilterValues>): number {
  return FILTER_KEYS.filter((key) => isActiveFilter(key, values)).length;
}

/** Which option the four-way activity control is on. */
export function showValueOf(values: Readonly<ListingFilterValues>): ListingShowValue {
  if (values.hidden === true) {
    return 'hidden';
  }
  return values.active === null ? 'all' : (String(values.active) as 'true' | 'false');
}

/** The URL patch for picking one of the four activity options. */
export function showPatch(value: ListingShowValue): ListingFilterPatch {
  if (value === 'hidden') {
    return { hidden: true, active: null, page: 1 };
  }
  return { hidden: false, active: value === 'all' ? null : value === 'true', page: 1 };
}

/** The URL patch for switching one filter off. */
export function clearFilter(key: string): ListingFilterPatch {
  if (key === 'active' || key === 'hidden') {
    return showPatch('all');
  }
  if (key === 'mtech') {
    return { mtech: NEUTRAL.mtech, [MOBILE_OPERATOR_KEY]: NEUTRAL[MOBILE_OPERATOR_KEY], page: 1 };
  }
  return { [key]: neutralValueForKey(key), page: 1 };
}

/**
 * The URL patch for switching every filter off. Leaves the search box, the sort and the page size
 * alone: those are not filters, and clearing them is not what the button says.
 */
export function clearAllFilters(): ListingFilterPatch {
  return { ...NEUTRAL, page: 1 };
}

/** A named list of the filters currently on, ready to render as chips. */
export function describeActiveFilters(
  values: Readonly<ListingFilterValues>,
  { t, jobs = [], providers = [] }: DescribeListingFiltersContext,
): Array<{ key: VisibleListingFilterKey; label: string }> {
  const named = (list: NamedFilterOption[], id: string | null): string =>
    list.find((entry) => entry.id === id)?.name ?? id ?? '';

  const labels: Record<VisibleListingFilterKey, () => string> = {
    hidden: () => t('listings.filterHidden'),
    active: () => (values.active === true ? t('listings.filterActive') : t('listings.filterInactive')),
    watch: () => (values.watch === true ? t('listings.filterWatched') : t('listings.filterUnwatched')),
    status: () => {
      const status = values.status;
      return status == null
        ? ''
        : ({
            applied: t('listings.filterStatusApplied'),
            rejected: t('listings.filterStatusRejected'),
            accepted: t('listings.filterStatusAccepted'),
            none: t('listings.filterStatusNone'),
          }[status] ?? status);
    },
    afford: () => {
      const afford = values.afford;
      return afford == null
        ? ''
        : ({
            affordable: t('listings.filterAffordabilityYes'),
            stretch: t('listings.filterAffordabilityStretch'),
            unaffordable: t('listings.filterAffordabilityNo'),
          }[afford] ?? afford);
    },
    commute: () => {
      const commute = values.commute;
      const parsed = parseCommuteFilter(commute);
      return parsed == null
        ? (commute ?? '')
        : t('listings.filterCommuteOption', {
            mode: t(`travelTime.mode.${parsed.mode}`),
            minutes: parsed.maxMinutes,
          });
    },
    down: () => t('listings.filterDownstreamOption', { mbit: values.down ?? 0 }),
    fiber: () => t('listings.filterFiberOnly'),
    mtech: () => {
      const technology = t(`connectivity.tech.${values.mtech ?? ''}`);
      const operator = values[MOBILE_OPERATOR_KEY];
      return operator == null
        ? technology
        : t('listings.filterMobileWithOperator', {
            technology,
            operator: t(`connectivity.operator.${operator}`),
          });
    },
    provider: () => named(providers, values.provider),
    job: () => named(jobs, values.job),
  };

  return FILTER_KEYS.filter((key) => isActiveFilter(key, values)).map((key) => ({
    key,
    label: labels[key](),
  }));
}

/**
 * Restricts available providers to those for which results exist or which are configured in the
 * user's jobs. An active provider filter is always preserved.
 */
export function filterConfiguredProviders(
  providers: NamedFilterOption[] | null = [],
  jobs: ConfiguredJobMetadata[] | null = [],
  selectedJobId: string | null = null,
  currentProviderId: string | null = null,
  availableProviders: string[] | null = null,
): NamedFilterOption[] {
  if (!Array.isArray(providers) || providers.length === 0) {
    return [];
  }

  if (Array.isArray(availableProviders) && availableProviders.length > 0) {
    const resultProviderIds = new Set(availableProviders);
    return providers.filter(
      (provider) =>
        resultProviderIds.has(provider.id) || (currentProviderId != null && provider.id === currentProviderId),
    );
  }

  if (!Array.isArray(jobs) || jobs.length === 0) {
    return providers;
  }

  const relevantJobs = selectedJobId
    ? jobs.filter((job) => job?.id === selectedJobId || job?.name === selectedJobId)
    : jobs;
  const targetJobs = relevantJobs.length > 0 ? relevantJobs : jobs;

  const configuredProviderIds = new Set<string>();
  for (const job of targetJobs) {
    if (!Array.isArray(job?.provider)) continue;
    for (const provider of job.provider) {
      const id = provider?.id || provider?.name;
      if (id) configuredProviderIds.add(id);
    }
  }

  if (configuredProviderIds.size === 0) {
    return providers;
  }

  return providers.filter(
    (provider) =>
      configuredProviderIds.has(provider.id) || (currentProviderId != null && provider.id === currentProviderId),
  );
}

function valueForKey(values: Readonly<ListingFilterValues>, key: string): unknown {
  return key in values ? values[key as keyof ListingFilterValues] : undefined;
}

function neutralValueForKey(key: string): unknown {
  return key in NEUTRAL ? NEUTRAL[key as ListingFilterKey] : undefined;
}
