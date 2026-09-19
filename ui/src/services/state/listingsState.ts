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
  mapListings: unknown[];
  currentListing: unknown | null;
  maxPrice: number;
  [key: string]: unknown;
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

export interface ListingsEffects {
  getListingsData(params: ListingsDataQuery): Promise<void>;
  getListing(listingId: string): Promise<unknown>;
  getListingsForMap(params?: ListingsMapQuery): Promise<void>;
  setListingStatus(listingId: string, status: unknown): Promise<void>;
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
  return {
    async getListingsData({
      page = 1,
      pageSize = 20,
      freeTextFilter = null,
      sortfield = null,
      sortdir = 'asc',
      filter,
    }) {
      try {
        const query = stringify(
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
        const response = await transport.get(`/api/listings/table?${query}`);
        set((state) => ({
          listingsData: { ...state.listingsData, ...asRecord(response.json) },
        }));
      } catch (exception) {
        console.error('Error while trying to get resource for api/listings. Error:', exception);
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

    async setListingStatus(listingId, status) {
      try {
        await transport.post(`/api/listings/${listingId}/status`, { status });
      } catch (exception) {
        console.error(`Error while trying to set status for listing ${listingId}. Error:`, exception);
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
