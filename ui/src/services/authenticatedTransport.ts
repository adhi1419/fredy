/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { resolveApiUrl } from './apiUrl.js';

export const UNAUTHORIZED_EVENT = 'fredy:unauthorized';

export type TokenGetter = (forceRefresh?: boolean) => Promise<string | null>;
export type TransportInput = string | URL | Request;
export type UnauthorizedEventTarget = Pick<EventTarget, 'dispatchEvent'>;

export interface AuthenticatedRequestPolicyDependencies {
  fetchImpl?: typeof fetch;
  tokenGetter?: TokenGetter;
  apiBaseUrl?: string;
  eventTarget?: UnauthorizedEventTarget;
}

/**
 * The small interface used by the two real protocol adapters. Ordinary HTTP uses `request` and
 * `publicRequest`; SSE additionally uses `handleSse` for its broader 401/403 transition rule.
 */
export interface AuthenticatedRequestPolicy {
  request(input: TransportInput, options?: RequestInit, forceRefresh?: boolean): Promise<Response>;
  publicRequest(input: TransportInput, options?: RequestInit): Promise<Response>;
  handleSse(status: number): boolean;
}

/** Add or remove the bearer header without mutating caller-owned headers. */
export function headersWithBearer(headers: HeadersInit | undefined, token: string | null): Headers {
  const result = new Headers(headers);
  if (token) {
    result.set('Authorization', `Bearer ${token}`);
  } else {
    result.delete('Authorization');
  }
  return result;
}

/** Apply the ordinary HTTP unauthorized rule used by the JSON response adapter. */
export function dispatchHttpUnauthorized(
  status: number,
  reason?: unknown,
  eventTarget?: UnauthorizedEventTarget,
): boolean {
  return dispatchIf(status === 401 || (status === 403 && reason === 'not allowed'), eventTarget);
}

export function createAuthenticatedRequestPolicy(
  dependencies: AuthenticatedRequestPolicyDependencies = {},
): AuthenticatedRequestPolicy {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const eventTarget = dependencies.eventTarget ?? defaultEventTarget();

  return {
    async request(input, options = {}, forceRefresh = false) {
      if (!dependencies.tokenGetter) {
        throw new TypeError('Authenticated request policy requires a token getter');
      }
      const token = await dependencies.tokenGetter(forceRefresh);
      return fetchImpl(resolveApiUrl(input, dependencies.apiBaseUrl), {
        ...options,
        credentials: 'omit',
        headers: headersWithBearer(options.headers, token),
      });
    },

    async publicRequest(input, options = {}) {
      return fetchImpl(resolveApiUrl(input, dependencies.apiBaseUrl), {
        ...options,
        credentials: 'omit',
        headers: headersWithBearer(options.headers, null),
      });
    },

    handleSse(status) {
      return dispatchIf(status === 401 || status === 403, eventTarget);
    },
  };
}

function dispatchIf(unauthorized: boolean, eventTarget: UnauthorizedEventTarget | undefined): boolean {
  const target = eventTarget ?? defaultEventTarget();
  if (unauthorized && target && typeof CustomEvent !== 'undefined') {
    target.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  return unauthorized;
}

function defaultEventTarget(): UnauthorizedEventTarget | undefined {
  return typeof window !== 'undefined' ? window : undefined;
}
