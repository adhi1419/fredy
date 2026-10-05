/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { InquiryDeliveryError } from '../inquiries/errors.js';
import { getProviderCredential, rotateProviderCredential } from '../storage/providerCredentialStorage.js';

const PROVIDER_ID = 'kleinanzeigen';
// This experiment switches listing pages to an Astro application that does not expose the
// server-rendered contact form Fredy's direct sender requires. It is not authentication state and
// must never become part of the renewable provider credential.
const IGNORED_COOKIE_NAMES = new Set(['__ka_vip-astro-v1']);
const defaultCredentialStore = {
  get: getProviderCredential,
  rotate: rotateProviderCredential,
};

function parseCookieHeader(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new InquiryDeliveryError('Kleinanzeigen account is not connected.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }
  const cookies = new Map();
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    if (name && cookieValue && !IGNORED_COOKIE_NAMES.has(name)) cookies.set(name, cookieValue);
  }
  if (cookies.size === 0) {
    throw new InquiryDeliveryError('Kleinanzeigen account is not connected.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }
  return cookies;
}

const serializeCookies = (cookies) => [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

function responseCookies(response) {
  if (typeof response?.headers?.getSetCookie === 'function') return response.headers.getSetCookie();
  const combined = response?.headers?.get?.('set-cookie');
  return combined ? [combined] : [];
}

function applySetCookie(cookies, header) {
  const first = String(header).split(';', 1)[0];
  const separator = first.indexOf('=');
  if (separator <= 0) return;
  const name = first.slice(0, separator).trim();
  const value = first.slice(separator + 1).trim();
  if (!name) return;
  if (IGNORED_COOKIE_NAMES.has(name)) {
    cookies.delete(name);
    return;
  }
  if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
  else cookies.set(name, value);
}

/** Load one encrypted Kleinanzeigen web session for its owning Fredy user. */
export async function getKleinanzeigenWebSession({ userId, credentialStore = defaultCredentialStore } = {}) {
  const ownerId = typeof userId === 'string' ? userId.trim() : '';
  if (!ownerId) {
    throw new InquiryDeliveryError('Kleinanzeigen account authentication requires a Fredy user.', {
      outcome: 'failed',
      phase: 'authentication',
      permanent: true,
    });
  }

  let credential;
  try {
    credential = await credentialStore.get(ownerId, PROVIDER_ID);
  } catch (error) {
    throw new InquiryDeliveryError('Fredy could not read the connected Kleinanzeigen account.', {
      outcome: 'failed',
      phase: 'authentication',
      cause: error,
    });
  }
  if (!credential?.secret || !Number.isInteger(credential.revision)) {
    throw new InquiryDeliveryError('Kleinanzeigen account is not connected.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }

  return {
    userId: ownerId,
    revision: credential.revision,
    cookies: parseCookieHeader(credential.secret),
    credentialStore,
  };
}

/** Add the session cookie to one provider request without exposing it to callers or logs. */
export function withKleinanzeigenSession(session, options = {}) {
  return {
    ...options,
    headers: {
      ...options.headers,
      Cookie: serializeCookies(session.cookies),
    },
  };
}

/** Persist cookies rotated by Kleinanzeigen before another request uses them. */
export async function persistKleinanzeigenSessionCookies(session, response) {
  const next = new Map(session.cookies);
  for (const header of responseCookies(response)) applySetCookie(next, header);
  const secret = serializeCookies(next);
  if (secret === serializeCookies(session.cookies)) return session;

  try {
    const revision = await session.credentialStore.rotate({
      userId: session.userId,
      providerId: PROVIDER_ID,
      secret,
      expectedRevision: session.revision,
    });
    return { ...session, cookies: next, revision };
  } catch (error) {
    throw new InquiryDeliveryError('Fredy could not securely store the refreshed Kleinanzeigen session.', {
      outcome: 'failed',
      phase: 'authentication',
      cause: error,
    });
  }
}
