/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getIdToken } from './auth/firebaseAuth.js';
import {
  createAuthenticatedRequestPolicy,
  headersWithBearer,
  type AuthenticatedRequestPolicyDependencies,
  type TransportInput,
} from './authenticatedTransport.js';

/**
 * Fetch an API resource with a Firebase bearer token when a user is available. Cookies are always
 * omitted so the browser cannot silently fall back to the retired session-cookie transport.
 *
 * The optional dependencies are a test seam and also keep this utility usable by small clients
 * that need to provide a fetch implementation explicitly.
 */
export function authenticatedFetch(
  input: TransportInput,
  options: RequestInit = {},
  dependencies: AuthenticatedRequestPolicyDependencies = {},
): Promise<Response> {
  return createAuthenticatedRequestPolicy({
    ...dependencies,
    tokenGetter: dependencies.tokenGetter ?? getIdToken,
  }).request(input, options);
}

/** Fetch a public bootstrap resource without cookies or authorization headers. */
export function publicFetch(
  input: TransportInput,
  options: RequestInit = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Response> {
  return createAuthenticatedRequestPolicy({ fetchImpl }).publicRequest(input, options);
}

export { headersWithBearer };
