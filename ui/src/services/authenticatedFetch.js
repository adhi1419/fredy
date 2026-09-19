/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getIdToken } from './auth/firebaseAuth.js';

/**
 * Add or remove the bearer header without mutating caller-owned headers.
 *
 * @param {HeadersInit|undefined} headers
 * @param {string|null} token
 * @returns {Headers}
 */
export function headersWithBearer(headers, token) {
  const result = new Headers(headers);
  if (token) {
    result.set('Authorization', `Bearer ${token}`);
  } else {
    result.delete('Authorization');
  }
  return result;
}

/**
 * Fetch an API resource with a Firebase bearer token when a user is available. Cookies are always
 * omitted so the browser cannot silently fall back to the retired session-cookie transport.
 *
 * The optional dependencies are a test seam and also keep this utility usable by small clients
 * that need to provide a fetch implementation explicitly.
 *
 * @param {RequestInfo|URL} input
 * @param {RequestInit} [options]
 * @param {{fetchImpl?: typeof fetch, tokenGetter?: (forceRefresh?: boolean) => Promise<string|null>}} [dependencies]
 * @returns {Promise<Response>}
 */
export async function authenticatedFetch(input, options = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const tokenGetter = dependencies.tokenGetter ?? getIdToken;
  const token = await tokenGetter(false);

  return fetchImpl(input, {
    ...options,
    credentials: 'omit',
    headers: headersWithBearer(options.headers, token),
  });
}

/**
 * Fetch a public bootstrap resource without cookies or authorization headers.
 *
 * @param {RequestInfo|URL} input
 * @param {RequestInit} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Response>}
 */
export function publicFetch(input, options = {}, fetchImpl = globalThis.fetch) {
  return fetchImpl(input, {
    ...options,
    credentials: 'omit',
    headers: headersWithBearer(options.headers, null),
  });
}
