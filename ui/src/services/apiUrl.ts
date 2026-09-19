/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';

/**
 * Resolve a frontend request against the optional Cloud Run API origin.
 *
 * An empty base keeps local development same-origin, where Vite proxies `/api` to the backend.
 * Absolute and protocol-relative URLs are intentionally left unchanged so external resources keep
 * their existing behavior.
 */
export function resolveApiUrl(input: string | URL | Request, apiBaseUrl?: string): string | URL | Request;
export function resolveApiUrl(input: unknown, apiBaseUrl: unknown = configuredApiBaseUrl): unknown {
  if (typeof input !== 'string' && !(typeof URL !== 'undefined' && input instanceof URL)) {
    return input;
  }

  const value = input instanceof URL ? input.toString() : input;
  const baseUrl = typeof apiBaseUrl === 'string' ? apiBaseUrl.trim() : '';
  if (!baseUrl || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) {
    return input;
  }

  return new URL(value, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}
