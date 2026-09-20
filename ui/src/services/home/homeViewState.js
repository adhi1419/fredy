/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The Home URL state is deliberately independent of the React view. It is the one contract shared
 * by the quiet feed, List + map, and the old /listings and /map entry points.
 */

export const HOME_PAGE_SIZE = 40;

export const HOME_VIEWS = Object.freeze(['feed', 'map']);
export const HOME_ACTIVITIES = Object.freeze(['new', 'applied', 'viewed', 'archived']);

export const HOME_SORT_OPTIONS = Object.freeze([
  Object.freeze({ key: 'created_at', direction: 'desc', labelKey: 'home.sortNewest' }),
  Object.freeze({ key: 'travel_time', direction: 'asc', labelKey: 'home.sortTravelTime' }),
  Object.freeze({ key: 'distance', direction: 'asc', labelKey: 'home.sortDistance' }),
  Object.freeze({ key: 'price', direction: 'asc', labelKey: 'home.sortPrice' }),
  Object.freeze({ key: 'size', direction: 'desc', labelKey: 'home.sortSize' }),
]);

const DEFAULT_HOME_VIEW = 'feed';
const DEFAULT_ACTIVITY = 'new';
const DEFAULT_SORT = 'created_at';
const DEFAULT_DIRECTION = 'desc';

const LEGACY_STATUS_TO_ACTIVITY = Object.freeze({
  applied: 'applied',
  accepted: 'archived',
  rejected: 'archived',
  viewed: 'viewed',
  viewing: 'viewed',
  archived: 'archived',
  new: 'new',
  none: 'new',
});

/**
 * Normalize one or more provider query values into stable, unique provider IDs.
 * Repeated `provider` params and the comma-separated form are both accepted so old bookmarks and
 * the Home multi-select have one canonical representation.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeProviderIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      values
        .flatMap((entry) => String(entry ?? '').split(','))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * @param {string[]} providerIds
 * @returns {string|null}
 */
export function providerParamFromIds(providerIds) {
  const normalized = normalizeProviderIds(providerIds);
  return normalized.length > 0 ? normalized.join(',') : null;
}

/**
 * @param {URLSearchParams} searchParams
 * @param {'feed'|'map'} [defaultView]
 * @returns {{view: string, q: string|null, activity: string, providerIds: string[], sort: string, dir: string, page: number}}
 */
export function readHomeViewState(searchParams, defaultView = DEFAULT_HOME_VIEW) {
  const first = (...keys) => {
    for (const key of keys) {
      const value = searchParams.get(key);
      if (value != null && value !== '') return value;
    }
    return null;
  };

  const view = first('view') ?? defaultView;
  const activityValue = first('activity', 'status');
  const activity = HOME_ACTIVITIES.includes(activityValue)
    ? activityValue
    : (LEGACY_STATUS_TO_ACTIVITY[activityValue] ?? DEFAULT_ACTIVITY);
  const sort = first('sort', 'sortfield') ?? DEFAULT_SORT;
  const sortOption = HOME_SORT_OPTIONS.find((option) => option.key === sort);
  const providerValues = searchParams.getAll('provider');
  if (providerValues.length === 0) {
    providerValues.push(...searchParams.getAll('providerFilter'));
  }

  const parsedPage = Number(first('page'));
  return {
    view: HOME_VIEWS.includes(view) ? view : defaultView,
    q: first('q', 'freeTextFilter'),
    activity,
    providerIds: normalizeProviderIds(providerValues),
    sort,
    dir: first('dir', 'sortdir') ?? sortOption?.direction ?? DEFAULT_DIRECTION,
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  };
}

/**
 * Apply a partial Home state update in one URL navigation. Legacy aliases are removed only when
 * their canonical control changes, so unknown query values remain available to existing adapters.
 *
 * @param {URLSearchParams} searchParams
 * @param {Record<string, unknown>} patch
 * @param {'feed'|'map'} [defaultView]
 * @returns {URLSearchParams}
 */
export function writeHomeViewState(searchParams, patch, defaultView = DEFAULT_HOME_VIEW) {
  const next = new URLSearchParams(searchParams);
  const current = readHomeViewState(searchParams, defaultView);
  const state = { ...current, ...patch };

  if ('view' in patch) {
    if (state.view === defaultView) next.delete('view');
    else next.set('view', state.view);
  }
  if ('q' in patch) {
    if (state.q == null || state.q === '') next.delete('q');
    else next.set('q', state.q);
    next.delete('freeTextFilter');
  }
  if ('activity' in patch) {
    if (state.activity === DEFAULT_ACTIVITY) next.delete('activity');
    else next.set('activity', state.activity);
    next.delete('status');
  }
  if ('providerIds' in patch) {
    next.delete('provider');
    next.delete('providerFilter');
    const providerParam = providerParamFromIds(state.providerIds);
    if (providerParam != null) next.set('provider', providerParam);
  }
  if ('sort' in patch) {
    if (state.sort === DEFAULT_SORT) next.delete('sort');
    else next.set('sort', state.sort);
    next.delete('sortfield');
  }
  if ('dir' in patch) {
    const defaultDirection =
      HOME_SORT_OPTIONS.find((option) => option.key === state.sort)?.direction ?? DEFAULT_DIRECTION;
    if (state.dir === defaultDirection) next.delete('dir');
    else next.set('dir', state.dir);
    next.delete('sortdir');
  }
  if ('page' in patch) {
    if (state.page === 1) next.delete('page');
    else next.set('page', String(state.page));
  }

  return next;
}

/**
 * Translate Home state into the existing listing table action contract.
 *
 * @param {{page?: number, q?: string|null, activity?: string, providerIds?: string[], sort?: string, dir?: string}} state
 * @returns {{page: number, pageSize: number, freeTextFilter: string|null, sortfield: string, sortdir: string, filter: {statusFilter: string, providerFilter: string|null}}}
 */
export function homeQueryFromState(state) {
  return {
    page: state.page ?? 1,
    pageSize: HOME_PAGE_SIZE,
    freeTextFilter: state.q ?? null,
    sortfield: state.sort ?? DEFAULT_SORT,
    sortdir: state.dir ?? DEFAULT_DIRECTION,
    filter: {
      statusFilter: state.activity ?? DEFAULT_ACTIVITY,
      providerFilter: providerParamFromIds(state.providerIds ?? []),
    },
  };
}

/**
 * Return the canonical sort option, while retaining unknown future keys for the API contract.
 *
 * @param {string} sort
 * @returns {{key: string, direction: string, labelKey: string}}
 */
export function homeSortOption(sort) {
  return (
    HOME_SORT_OPTIONS.find((option) => option.key === sort) ?? {
      key: sort || DEFAULT_SORT,
      direction: DEFAULT_DIRECTION,
      labelKey: 'home.sortFuture',
    }
  );
}

/**
 * Preserve Home URL state only when navigating from a route that carries the same controls.
 * Saved Searches, account, admin, and finance query parameters must not leak into Home.
 *
 * @param {string} pathname
 * @param {string} search
 * @returns {string}
 */
export function homeSearchForNavigation(pathname, search) {
  const path = typeof pathname === 'string' ? pathname.split(/[?#]/, 1)[0] : '';
  const compatible = ['/dashboard', '/listings', '/map'].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!compatible) return '';

  const next = new URLSearchParams(typeof search === 'string' ? search : '');
  if (path === '/map' || path.startsWith('/map/')) next.set('view', 'map');
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Normalize one listing for map rendering, rejecting absent, sentinel, non-numeric, and out-of-range
 * coordinates before they can affect marker grouping or map bounds.
 *
 * @param {object|null|undefined} listing
 * @returns {object|null}
 */
export function homeMapListing(listing) {
  if (
    listing == null ||
    typeof listing !== 'object' ||
    listing.latitude == null ||
    listing.longitude == null ||
    listing.latitude === '' ||
    listing.longitude === ''
  ) {
    return null;
  }
  const latitude = Number(listing.latitude);
  const longitude = Number(listing.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    latitude === -1 ||
    longitude === -1
  ) {
    return null;
  }
  return { ...listing, latitude, longitude };
}

/**
 * @param {object|null|undefined} listing
 * @returns {string}
 */
export function homeLifecycleState(listing) {
  const lifecycle = listing?.lifecycle?.state;
  if (HOME_ACTIVITIES.includes(lifecycle)) return lifecycle;
  const legacy = listing?.status?.status;
  if (typeof legacy === 'string' && LEGACY_STATUS_TO_ACTIVITY[legacy]) {
    return LEGACY_STATUS_TO_ACTIVITY[legacy];
  }
  if (listing?.inquiry_send_status === 'sent') return 'applied';
  return 'new';
}
