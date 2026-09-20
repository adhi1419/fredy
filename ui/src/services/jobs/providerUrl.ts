/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** The smallest provider metadata boundary needed to validate a pasted URL. */
export interface ProviderMetadata {
  baseUrl?: string | null;
}

export interface ProviderWithBaseUrl {
  baseUrl?: string | null;
}

/** Every reason a provider URL can be refused. */
export type ProviderUrlProblem = 'noProvider' | 'empty' | 'unsupportedScheme' | 'unparsable' | 'wrongHost' | 'bareHost';

/** The validation result narrows the problem field through `ok`. */
export type ProviderUrlValidation =
  | { ok: true; problem: null; expectedHost: string }
  | { ok: false; problem: ProviderUrlProblem; expectedHost: string | null };

const HTTP_SCHEMES = new Set(['http:', 'https:']);
const EXPLICIT_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function hasUnsupportedScheme(value: string): boolean {
  const scheme = value.match(EXPLICIT_SCHEME)?.[0].toLowerCase();
  return scheme != null && !HTTP_SCHEMES.has(scheme);
}

/** Parse only HTTP(S) URLs, allowing the protocol-less legacy input format. */
function parseProviderUrl(value: string | null | undefined): URL | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed.length === 0 || hasUnsupportedScheme(trimmed)) return null;

  const withProtocol = EXPLICIT_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!HTTP_SCHEMES.has(parsed.protocol) || parsed.hostname.length === 0) return null;
    // Userinfo is never part of a provider search URL and can disguise a different destination.
    if (parsed.username.length > 0 || parsed.password.length > 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Whether a value is a usable HTTP(S) provider URL, including protocol-less legacy input. */
export function isHttpProviderUrl(value: string | null | undefined): boolean {
  return parseProviderUrl(value) != null;
}

/** Return a canonical HTTP(S) URL only when it matches the selected provider exactly. */
export function getSafeProviderUrl(
  value: string | null | undefined,
  provider: ProviderMetadata | null | undefined,
): string | null {
  const parsed = parseProviderUrl(value);
  if (parsed == null || provider == null) return null;
  return validateProviderUrl(value, provider).ok ? parsed.href : null;
}

/** Return a canonical HTTP(S) URL for provider metadata controlled by the application. */
export function getSafeHttpUrl(value: string | null | undefined): string | null {
  return parseProviderUrl(value)?.href ?? null;
}

/**
 * A URL reduced to its bare host, so that protocol and a leading `www.` do not cause a false
 * negative when comparing the user's input against the provider's base URL.
 */
export function normalizeHost(url: string | null | undefined): string | null {
  return (
    parseProviderUrl(url)
      ?.hostname.replace(/^www\./i, '')
      .toLowerCase() ?? null
  );
}

/**
 * Whether a URL carries anything past its host.
 *
 * A path of `/`, no query and no fragment means the user copied the address of the front page
 * rather than of their search results.
 */
function carriesASearch(url: string): boolean {
  const parsed = parseProviderUrl(url);
  return (
    parsed != null &&
    (parsed.pathname.replace(/\/+$/, '').length > 0 || parsed.search.length > 0 || parsed.hash.length > 0)
  );
}

/** Find provider metadata for a source URL using the same normalized-host seam as validation. */
export function findProviderByUrl<T extends ProviderWithBaseUrl>(
  url: string | null | undefined,
  providers: readonly T[] = [],
): T | null {
  const inputHost = normalizeHost(url);
  if (inputHost == null) return null;
  return providers.find((provider) => normalizeHost(provider?.baseUrl) === inputHost) ?? null;
}

/** Check a pasted provider URL. */
export function validateProviderUrl(
  url: string | null | undefined,
  provider: ProviderMetadata | null | undefined,
): ProviderUrlValidation {
  const expectedHost = normalizeHost(provider?.baseUrl);

  if (provider == null) {
    return { ok: false, problem: 'noProvider', expectedHost: null };
  }
  if (url == null || String(url).trim().length === 0) {
    return { ok: false, problem: 'empty', expectedHost };
  }
  if (hasUnsupportedScheme(String(url).trim())) {
    return { ok: false, problem: 'unsupportedScheme', expectedHost };
  }

  const inputHost = normalizeHost(url);
  if (inputHost == null) {
    return { ok: false, problem: 'unparsable', expectedHost };
  }
  if (expectedHost == null || inputHost !== expectedHost) {
    return { ok: false, problem: 'wrongHost', expectedHost };
  }
  if (!carriesASearch(url)) {
    return { ok: false, problem: 'bareHost', expectedHost };
  }
  return { ok: true, problem: null, expectedHost };
}
/* Copyright (c) 2026 by Christian Kellner. */
