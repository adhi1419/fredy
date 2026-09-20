/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The finance domain state and effects used by the aggregate Zustand store.
 *
 * Finance owns the server-backed response mapping and loading transitions. The aggregate store
 * injects the existing xhr adapters and only composes the returned effects under `actions.finance`.
 */

export interface FinanceState {
  data: unknown | null;
  loading: boolean;
  summary: unknown | null;
}

export interface FinanceRootState {
  finance: FinanceState;
}

export interface FinanceResponse {
  status: number;
  json: unknown;
}

export interface FinanceTransport {
  get(url: string): Promise<FinanceResponse>;
  post(url: string, data: unknown): Promise<FinanceResponse>;
}

export interface FinanceStateSetter {
  (updater: (state: FinanceRootState) => Partial<FinanceRootState>): void;
}

export type FinanceProfile = Record<string, unknown>;

export interface FinanceAffordabilityPayload {
  profile: FinanceProfile;
  filter?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FinanceEffects {
  getProfileSummary(): Promise<unknown | null>;
  calculate(profile: FinanceProfile): Promise<unknown | null>;
  getListingFinance(listingId: string): Promise<unknown | null>;
  getAffordability(payload: FinanceAffordabilityPayload): Promise<unknown>;
}

export function createFinanceState(): FinanceState {
  return { data: null, loading: false, summary: null };
}

export function createFinanceEffects(set: FinanceStateSetter, transport: FinanceTransport): FinanceEffects {
  return {
    /** Load the derived view of the stored finance profile. */
    async getProfileSummary() {
      try {
        const response = await transport.get('/api/finance/profile-summary');
        updateFinanceState(set, { summary: response.json });
        return response.json;
      } catch (exception) {
        console.error('Error while trying to load the finance profile summary. Error:', exception);
        return null;
      }
    },

    /** Run the calculator against a draft profile the user is still editing. */
    async calculate(profile) {
      try {
        const response = await transport.post('/api/finance/calculate', { profile });
        return response.json;
      } catch (exception) {
        // A 400 here is the normal "not enough entered yet" case, not a failure worth shouting about.
        if (statusOf(exception) !== 400) {
          console.error('Error while trying to calculate financing. Error:', exception);
        }
        return null;
      }
    },

    /** Load the financing breakdown for one listing against the stored profile. */
    async getListingFinance(listingId) {
      try {
        const response = await transport.get(`/api/finance/listing/${listingId}`);
        return response.json;
      } catch (exception) {
        console.error(`Error while trying to load the financing of listing ${listingId}. Error:`, exception);
        return null;
      }
    },

    /** Score listings for affordability and retain the result in the finance slice. */
    async getAffordability(payload) {
      updateFinanceState(set, { loading: true });
      try {
        const response = await transport.post('/api/finance/affordability', payload);
        updateFinanceState(set, { data: response.json, loading: false });
        return response.json;
      } catch (exception) {
        console.error('Error while trying to score listings for affordability. Error:', exception);
        updateFinanceState(set, { loading: false });
        throw exception;
      }
    },
  };
}

function updateFinanceState(set: FinanceStateSetter, patch: Partial<FinanceState>): void {
  set((state) => ({ finance: { ...state.finance, ...patch } }));
}

function statusOf(exception: unknown): unknown {
  return typeof exception === 'object' && exception !== null && 'status' in exception ? exception.status : undefined;
}
