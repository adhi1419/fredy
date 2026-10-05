/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The listings domain state and effects used by the aggregate Zustand store.
 *
 * The request functions are injected by the aggregate store. They are the existing xhr adapters,
 * which in turn use the shared authenticated transport policy; this module therefore owns listing
 * behavior without growing a second bearer/origin/unauthorized implementation.
 */

export interface ListingsDataState {
  totalNumber: number;
  page: number;
  result: unknown[];
  availableProviders: string[];
  /** Every coordinate-bearing row matching the Home filters, regardless of pagination. */
  pins: unknown[];
  /** One tally per lifecycle state over the Home filters minus the activity; null until fetched. */
  counts: ListingsActivityCounts | null;
  mapListings: unknown[];
  currentListing: unknown | null;
  maxPrice: number;
  [key: string]: unknown;
}

export interface ListingsActivityCounts {
  new: number;
  applied: number;
  viewed: number;
  archived: number;
}

export interface ListingsRootState {
  listingsData: ListingsDataState;
}

export interface ListingsResponse {
  status: number;
  json: unknown;
}

export interface ListingsTransport {
  get(url: string): Promise<ListingsResponse>;
  post(url: string, data: unknown): Promise<ListingsResponse>;
}

export type ListingsQueryStringify = (
  query: Record<string, unknown>,
  options?: { skipNull?: boolean; skipEmptyString?: boolean },
) => string;

export interface ListingsStateSetter {
  (updater: (state: ListingsRootState) => Partial<ListingsRootState>): void;
}

export interface ListingsDataQuery {
  page?: number;
  pageSize?: number;
  freeTextFilter?: string | null;
  sortfield?: string | null;
  sortdir?: string;
  filter?: Record<string, unknown>;
}

export interface ListingsMapQuery {
  jobId?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface ListingPosition {
  address: string;
  latitude: number;
  longitude: number;
}

export type ListingLifecycleAction = 'applied' | 'viewing' | 'archive' | 'restore';

export interface ListingsEffects {
  getListingsData(params: ListingsDataQuery): Promise<void>;
  /**
   * Fetches the page after the one currently held and appends its rows, for an endless feed. A
   * response for a different query than the one in flight when it returns is dropped, so a filter
   * change mid-scroll cannot splice stale rows into the new result.
   */
  appendListingsPage(params: ListingsDataQuery): Promise<void>;
  /**
   * Fetches the pins for a filter set: every matching row with coordinates, unpaginated, via the
   * table endpoint's `pins=true` mode. Page, size and sort are irrelevant to pins and dropped, so a
   * scroll or a re-sort never refetches them. A response for a superseded filter is discarded.
   */
  getListingsPins(params: ListingsDataQuery): Promise<void>;
  /**
   * Fetches the four activity counts for a filter set via `counts=true`. The status filter is
   * dropped from the request (the server ignores it anyway), so switching tabs never refetches the
   * tallies. A response for a superseded filter is discarded.
   */
  getListingsCounts(params: ListingsDataQuery): Promise<void>;
  getListing(listingId: string): Promise<unknown>;
  getListingsForMap(params?: ListingsMapQuery): Promise<void>;
  setListingLifecycleAction(listingId: string, action: ListingLifecycleAction): Promise<void>;
  setListingNotes(listingId: string, notes: unknown): Promise<void>;
  setListingAddress(listingId: string, position: ListingPosition): Promise<void>;
  toggleListingWatch(listingId: string): Promise<void>;
  restoreListings(ids: string[]): Promise<void>;
  reactivateListings(ids: string[]): Promise<void>;
}

export function createListingsDataState(): ListingsDataState {
  return {
    totalNumber: 0,
    page: 1,
    result: [],
    availableProviders: [],
    pins: [],
    counts: null,
    mapListings: [],
    currentListing: null,
    maxPrice: 0,
  };
}

export function createListingsEffects(
  set: ListingsStateSetter,
  transport: ListingsTransport,
  stringify: ListingsQueryStringify,
): ListingsEffects {
  // Identity of the last query getListingsData issued, minus the page. appendListingsPage compares
  // against it when its response lands so a page fetched for a superseded filter is discarded.
  let currentQueryKey = '';
  let appendInFlight = false;
  let currentPinsKey = '';
  let currentCountsKey = '';

  const queryOf = ({
    page = 1,
    pageSize = 20,
    freeTextFilter = null,
    sortfield = null,
    sortdir = 'asc',
    filter,
  }: ListingsDataQuery) =>
    stringify(
      {
        page,
        pageSize,
        freeTextFilter,
        sortfield,
        sortdir,
        ...(filter ?? {}),
      },
      { skipNull: true, skipEmptyString: true },
    );

  const keyOf = (params: ListingsDataQuery) => queryOf({ ...params, page: 1 });

  return {
    async getListingsData(params) {
      const key = keyOf(params);
      currentQueryKey = key;
      try {
        const response = await transport.get(`/api/listings/table?${queryOf(params)}`);
        if (currentQueryKey !== key) return;
        const payload = asRecord(response.json);
        set((state) => ({
          listingsData: {
            ...state.listingsData,
            ...payload,
            availableProviders: stringArray(payload.availableProviders),
          },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/listings. Error:', exception);
      }
    },

    async appendListingsPage(params) {
      if (appendInFlight) return;
      const key = keyOf(params);
      if (key !== currentQueryKey) return;
      appendInFlight = true;
      try {
        const response = await transport.get(`/api/listings/table?${queryOf(params)}`);
        if (currentQueryKey !== key) return;
        const payload = asRecord(response.json);
        const rows = Array.isArray(payload.result) ? payload.result : [];
        set((state) => ({
          listingsData: {
            ...state.listingsData,
            ...payload,
            result: [...state.listingsData.result, ...rows],
            availableProviders: stringArray(payload.availableProviders),
          },
        }));
      } catch (exception) {
        console.error('Error while trying to append a page from api/listings. Error:', exception);
      } finally {
        appendInFlight = false;
      }
    },

    async getListingsPins(params) {
      // The server ignores page, size and sort in pins mode; pinning them here keeps the key stable.
      const pinsQuery = queryOf({
        ...params,
        page: 1,
        pageSize: 1,
        sortfield: null,
        sortdir: 'asc',
        filter: { ...(params.filter ?? {}), pins: true },
      });
      currentPinsKey = pinsQuery;
      try {
        const response = await transport.get(`/api/listings/table?${pinsQuery}`);
        if (currentPinsKey !== pinsQuery) return;
        const payload = asRecord(response.json);
        set((state) => ({
          listingsData: {
            ...state.listingsData,
            pins: Array.isArray(payload.pins) ? payload.pins : [],
          },
        }));
      } catch (exception) {
        console.error('Error while trying to get pins from api/listings. Error:', exception);
      }
    },

    async getListingsCounts(params) {
      const { statusFilter: _ignored, ...filter } = params.filter ?? {};
      const countsQuery = queryOf({
        ...params,
        page: 1,
        pageSize: 1,
        sortfield: null,
        sortdir: 'asc',
        filter: { ...filter, counts: true },
      });
      currentCountsKey = countsQuery;
      try {
        const response = await transport.get(`/api/listings/table?${countsQuery}`);
        if (currentCountsKey !== countsQuery) return;
        const payload = asRecord(response.json);
        const raw = asRecord(payload.counts);
        const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        set((state) => ({
          listingsData: {
            ...state.listingsData,
            counts: {
              new: num(raw.new),
              applied: num(raw.applied),
              viewed: num(raw.viewed),
              archived: num(raw.archived),
            },
          },
        }));
      } catch (exception) {
        console.error('Error while trying to get activity counts from api/listings. Error:', exception);
      }
    },

    async getListing(listingId) {
      try {
        const response = await transport.get(`/api/listings/${listingId}`);
        set((state) => ({
          listingsData: { ...state.listingsData, currentListing: response.json },
        }));
        return response.json;
      } catch (exception) {
        console.error(`Error while trying to get resource for api/listings/${listingId}. Error:`, exception);
        throw exception;
      }
    },

    async getListingsForMap({ jobId, minPrice, maxPrice } = {}) {
      try {
        const query = stringify(
          {
            jobId,
            minPrice,
            maxPrice,
          },
          { skipNull: true, skipEmptyString: true },
        );
        const response = await transport.get(`/api/listings/map?${query}`);
        const payload = asRecord(response.json);
        set((state) => ({
          listingsData: {
            ...state.listingsData,
            mapListings: Array.isArray(payload.listings) ? payload.listings : [],
            maxPrice: numberOrZero(payload.maxPrice),
          },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/listings/map. Error:', exception);
      }
    },

    async setListingLifecycleAction(listingId, action) {
      try {
        await transport.post(`/api/listings/${listingId}/status`, { action });
      } catch (exception) {
        console.error(`Error while trying to set lifecycle action for listing ${listingId}. Error:`, exception);
        throw exception;
      }
    },

    async setListingNotes(listingId, notes) {
      try {
        await transport.post(`/api/listings/${listingId}/notes`, { notes });
      } catch (exception) {
        console.error(`Error while trying to set notes for listing ${listingId}. Error:`, exception);
        throw exception;
      }
    },

    async setListingAddress(listingId, { address, latitude, longitude }) {
      try {
        await transport.post(`/api/listings/${listingId}/address`, { address, latitude, longitude });
      } catch (exception) {
        console.error(`Error while trying to set address for listing ${listingId}. Error:`, exception);
        throw exception;
      }
    },

    async toggleListingWatch(listingId) {
      try {
        await transport.post('/api/listings/watch', { listingId });
      } catch (exception) {
        console.error(`Error while trying to toggle watch for listing ${listingId}. Error:`, exception);
        throw exception;
      }
    },

    async restoreListings(ids) {
      try {
        await transport.post('/api/listings/restore', { ids });
      } catch (exception) {
        console.error('Error while trying to restore listings. Error:', exception);
        throw exception;
      }
    },

    async reactivateListings(ids) {
      try {
        await transport.post('/api/listings/reactivate', { ids });
      } catch (exception) {
        console.error('Error while trying to reactivate listings. Error:', exception);
        throw exception;
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
