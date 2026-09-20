/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The Home URL state is deliberately independent of the React view. It is the one contract shared
 * by the quiet feed, List + map, and the old /listings and /map entry points.
 */

export type HomeView = 'feed' | 'map';
export type HomeActivity = 'new' | 'applied' | 'viewed' | 'archived';
export type KnownHomeSortKey = 'created_at' | 'travel_time' | 'distance' | 'price' | 'size';

/** Known sort keys plus future server-supported keys that this client does not know yet. */
export type HomeSortKey = KnownHomeSortKey | (string & {});
export type HomeSortDirection = 'asc' | 'desc';

export interface HomeSortOption {
  readonly key: HomeSortKey;
  readonly direction: HomeSortDirection;
  readonly labelKey: string;
}

export interface HomeProviderMetadata {
  readonly id?: string | null;
  readonly name?: string | null;
}

export interface HomeProviderOption {
  readonly id: string;
  readonly name: string;
}

export interface HomeViewState {
  view: HomeView;
  q: string | null;
  activity: HomeActivity;
  providerIds: string[];
  sort: HomeSortKey;
  dir: string;
  page: number;
}

export type HomeViewStatePatch = Partial<HomeViewState>;

export interface HomeQueryState {
  page?: number;
  q?: string | null;
  activity?: HomeActivity;
  providerIds?: readonly string[];
  sort?: HomeSortKey;
  dir?: string;
}

export interface HomeQueryFilter {
  statusFilter: HomeActivity;
  providerFilter: string | null;
}

export interface HomeQueryPayload {
  page: number;
  pageSize: number;
  freeTextFilter: string | null;
  sortfield: HomeSortKey;
  sortdir: string;
  filter: HomeQueryFilter;
}

/** Known listing fields used by Home; unmodeled API fields remain available as unknown extensions. */
export interface HomeListing {
  id?: string;
  title?: string | null;
  address?: string | null;
  provider?: string | null;
  image_url?: string | null;
  price?: number | string | null;
  size?: number | string | null;
  created_at?: string | number | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  lifecycle?: { state?: string | null } | null;
  status?: { status?: string | null } | null;
  inquiry_send_status?: string | null;
  [key: string]: unknown;
}

export interface HomeMapListing extends HomeListing {
  latitude: number;
  longitude: number;
}

export const HOME_PAGE_SIZE = 40;

export const HOME_VIEWS: readonly HomeView[] = Object.freeze(['feed', 'map']);
export const HOME_ACTIVITIES: readonly HomeActivity[] = Object.freeze(['new', 'applied', 'viewed', 'archived']);

export const HOME_SORT_OPTIONS: readonly HomeSortOption[] = Object.freeze([
  Object.freeze({ key: 'created_at', direction: 'desc', labelKey: 'home.sortNewest' }),
  Object.freeze({ key: 'travel_time', direction: 'asc', labelKey: 'home.sortTravelTime' }),
  Object.freeze({ key: 'distance', direction: 'asc', labelKey: 'home.sortDistance' }),
  Object.freeze({ key: 'price', direction: 'asc', labelKey: 'home.sortPrice' }),
  Object.freeze({ key: 'size', direction: 'desc', labelKey: 'home.sortSize' }),
]);

const DEFAULT_HOME_VIEW: HomeView = 'feed';
const DEFAULT_ACTIVITY: HomeActivity = 'new';
const DEFAULT_SORT: KnownHomeSortKey = 'created_at';
const DEFAULT_DIRECTION: HomeSortDirection = 'desc';

const LEGACY_STATUS_TO_ACTIVITY: Readonly<Record<string, HomeActivity>> = Object.freeze({
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
 */
export function normalizeProviderIds(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
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
 * Derive provider controls from providers that are present in the accessible listing set. Selected
 * IDs are retained after the available set so a stale URL selection remains clearable.
 */
export function homeProviderOptions(
  providerMetadata: readonly HomeProviderMetadata[] | null | undefined,
  availableProviders: readonly string[] | null | undefined,
  selectedProviderIds: readonly string[] = [],
): HomeProviderOption[] {
  const namesById = new Map<string, string>();
  for (const provider of providerMetadata ?? []) {
    const id = nonEmptyProviderValue(provider.id) ?? nonEmptyProviderValue(provider.name);
    if (id == null) continue;
    namesById.set(id, nonEmptyProviderValue(provider.name) ?? id);
  }

  const ids = [
    ...new Set([...normalizeProviderIds(availableProviders ?? []), ...normalizeProviderIds(selectedProviderIds)]),
  ];
  return ids.map((id) => ({ id, name: namesById.get(id) ?? id }));
}

function nonEmptyProviderValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function providerParamFromIds(providerIds: readonly string[]): string | null {
  const normalized = normalizeProviderIds(providerIds);
  return normalized.length > 0 ? normalized.join(',') : null;
}

export function readHomeViewState(
  searchParams: URLSearchParams,
  defaultView: HomeView = DEFAULT_HOME_VIEW,
): HomeViewState {
  const first = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = searchParams.get(key);
      if (value != null && value !== '') return value;
    }
    return null;
  };

  const viewValue = first('view');
  const view = isHomeView(viewValue) ? viewValue : defaultView;
  const activityValue = first('activity', 'status');
  const activity = isHomeActivity(activityValue)
    ? activityValue
    : (LEGACY_STATUS_TO_ACTIVITY[activityValue ?? ''] ?? DEFAULT_ACTIVITY);
  const sort = first('sort', 'sortfield') ?? DEFAULT_SORT;
  const sortOption = HOME_SORT_OPTIONS.find((option) => option.key === sort);
  const providerValues = searchParams.getAll('provider');
  if (providerValues.length === 0) {
    providerValues.push(...searchParams.getAll('providerFilter'));
  }

  const parsedPage = Number(first('page'));
  return {
    view,
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
 */
export function writeHomeViewState(
  searchParams: URLSearchParams,
  patch: HomeViewStatePatch,
  defaultView: HomeView = DEFAULT_HOME_VIEW,
): URLSearchParams {
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

/** Translate Home state into the existing listing table action contract. */
export function homeQueryFromState(state: HomeQueryState): HomeQueryPayload {
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
 */
export function homeSortOption(sort: HomeSortKey): HomeSortOption {
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
 */
export function homeSearchForNavigation(pathname: string, search: string): string {
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
 */
export function homeMapListing(listing: HomeListing | null | undefined): HomeMapListing | null {
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

export function homeLifecycleState(listing: HomeListing | null | undefined): HomeActivity {
  const lifecycle = listing?.lifecycle?.state;
  if (isHomeActivity(lifecycle)) return lifecycle;
  const legacy = listing?.status?.status;
  if (typeof legacy === 'string' && LEGACY_STATUS_TO_ACTIVITY[legacy]) {
    return LEGACY_STATUS_TO_ACTIVITY[legacy];
  }
  if (listing?.inquiry_send_status === 'sent') return 'applied';
  return 'new';
}

function isHomeView(value: unknown): value is HomeView {
  return typeof value === 'string' && (HOME_VIEWS as readonly string[]).includes(value);
}

function isHomeActivity(value: unknown): value is HomeActivity {
  return typeof value === 'string' && (HOME_ACTIVITIES as readonly string[]).includes(value);
}
