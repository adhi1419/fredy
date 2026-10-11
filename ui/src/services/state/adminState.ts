/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Admin panel state: the access requests waiting on the operator.
 *
 * A request is a verified Google identity that signed in but is not on the allowlist. Approving
 * one writes the allowlist entry (never admin) and removes the request; declining keeps the row so
 * the same account cannot re-queue itself. The list is tiny and fully re-read after every action,
 * so the page never has to reconcile optimistic state.
 */

/** One row of `access_requests`, as the API returns it. */
export interface AccessRequest {
  email: string;
  displayName: string | null;
  uid: string;
  requestedAt: number;
  status: 'pending' | 'declined';
  decidedAt: number | null;
}

export interface AdminState {
  admin: {
    accessRequests: readonly AccessRequest[];
    accessRequestsLoaded: boolean;
  };
}

export interface AdminResponse<T> {
  status: number;
  json: T;
}

export interface AdminTransport {
  get<T>(url: string): Promise<AdminResponse<T>>;
  post<T>(url: string, data: unknown): Promise<AdminResponse<T>>;
  delete<T>(url: string): Promise<AdminResponse<T>>;
}

export interface AdminStateSetter {
  (updater: (state: AdminState) => Partial<AdminState>): void;
}

export interface AdminEffects {
  getAccessRequests(): Promise<void>;
  approveAccessRequest(email: string): Promise<void>;
  declineAccessRequest(email: string): Promise<void>;
  removeAccessRequest(email: string): Promise<void>;
}

export function createAdminState(): AdminState {
  return { admin: { accessRequests: [], accessRequestsLoaded: false } };
}

/** Pending first (oldest at the top), declined after. */
export function orderAccessRequests(requests: readonly AccessRequest[]): AccessRequest[] {
  const rank = (request: AccessRequest) => (request.status === 'pending' ? 0 : 1);
  return [...requests].sort((a, b) => rank(a) - rank(b) || a.requestedAt - b.requestedAt);
}

const BASE = '/api/admin/access-requests';

/** The email is a path segment; encode it so `+` tags and unusual characters survive the round trip. */
export function accessRequestPath(email: string, action?: 'approve' | 'decline'): string {
  const base = `${BASE}/${encodeURIComponent(email)}`;
  return action ? `${base}/${action}` : base;
}

export function createAdminEffects(set: AdminStateSetter, transport: AdminTransport): AdminEffects {
  async function getAccessRequests(): Promise<void> {
    const response = await transport.get<{ requests: readonly AccessRequest[] }>(BASE);
    set(() => ({ admin: { accessRequests: [...response.json.requests], accessRequestsLoaded: true } }));
  }

  return {
    getAccessRequests,
    async approveAccessRequest(email) {
      await transport.post(accessRequestPath(email, 'approve'), {});
      await getAccessRequests();
    },
    async declineAccessRequest(email) {
      await transport.post(accessRequestPath(email, 'decline'), {});
      await getAccessRequests();
    },
    async removeAccessRequest(email) {
      await transport.delete(accessRequestPath(email));
      await getAccessRequests();
    },
  };
}
