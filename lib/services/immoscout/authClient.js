/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { InquiryDeliveryError } from '../inquiries/errors.js';
import { getProviderCredential, rotateProviderCredential } from '../storage/providerCredentialStorage.js';

const TOKEN_URL = 'https://login.immobilienscout24.de/oauth2/aus1227au6oBg6hGH417/v1/token';
const MOBILE_API_BASE = 'https://api.mobile.immobilienscout24.de';
const CLIENT_ID = 'is24-android-de';
const SCOPES = 'openid profile offline_access';
export const IMMOSCOUT_USER_AGENT = 'ImmoScout24_1568_35_._';
const REFRESH_EARLY_MS = 60_000;

const cachedSessions = new Map();
const refreshesInFlight = new Map();
const defaultCredentialStore = {
  get: getProviderCredential,
  rotate: rotateProviderCredential,
};

const normalizedEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

async function jsonResponse(response, phase) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new InquiryDeliveryError(`ImmoScout ${phase} response could not be read.`, {
      outcome: 'failed',
      phase: 'authentication',
    });
  }
  if (!response.ok) {
    throw new InquiryDeliveryError(`ImmoScout account connection failed during ${phase} (HTTP ${response.status}).`, {
      outcome: 'failed',
      phase: 'authentication',
      status: response.status,
    });
  }
  return body;
}

async function authenticatedGet(fetchImpl, accessToken, path, phase) {
  const response = await fetchImpl(`${MOBILE_API_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': IMMOSCOUT_USER_AGENT,
    },
  });
  return jsonResponse(response, phase);
}

async function refreshSession({ userId, accountEmail, credentialStore, fetchImpl, now }) {
  let credential;
  try {
    credential = await credentialStore.get(userId, 'immoscout');
  } catch (error) {
    throw new InquiryDeliveryError('Fredy could not read the connected ImmoScout account.', {
      outcome: 'failed',
      phase: 'authentication',
      cause: error,
    });
  }
  const refreshToken = credential?.secret;
  if (!refreshToken) {
    throw new InquiryDeliveryError('ImmoScout account is not connected.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokens = await jsonResponse(tokenResponse, 'token refresh');
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw new InquiryDeliveryError('ImmoScout token refresh returned no access token.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }
  if (typeof tokens.refresh_token === 'string' && tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    try {
      await credentialStore.rotate({
        userId,
        providerId: 'immoscout',
        secret: tokens.refresh_token,
        expectedRevision: credential.revision,
      });
    } catch (error) {
      throw new InquiryDeliveryError('Fredy could not securely store the refreshed ImmoScout connection.', {
        outcome: 'failed',
        phase: 'authentication',
        cause: error,
      });
    }
  }

  const [account, entitlementData] = await Promise.all([
    authenticatedGet(fetchImpl, tokens.access_token, 'account/v2.0/user/me', 'account verification'),
    authenticatedGet(fetchImpl, tokens.access_token, 'account/v2.0/user/me/entitlements', 'entitlement verification'),
  ]);
  const connectedEmail = normalizedEmail(account.email);
  if (!connectedEmail || connectedEmail !== normalizedEmail(accountEmail)) {
    throw new InquiryDeliveryError('Connected ImmoScout account does not match the signed-in Fredy account.', {
      outcome: 'failed',
      phase: 'authentication',
      permanent: true,
    });
  }
  const ssoId = String(account.ssoId ?? '').trim();
  if (!ssoId) {
    throw new InquiryDeliveryError('Connected ImmoScout account returned no account id.', {
      outcome: 'failed',
      phase: 'authentication',
    });
  }

  const expiresIn = Number(tokens.expires_in);
  return {
    accessToken: tokens.access_token,
    ssoId,
    entitlements: Array.isArray(entitlementData.entitlements) ? entitlementData.entitlements : [],
    bundles: Array.isArray(entitlementData.bundles) ? entitlementData.bundles : [],
    hasMieterPlus: (entitlementData.bundles ?? []).some((bundle) => bundle?.productType === 'MIETER_PLUS'),
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0),
    accountEmail: connectedEmail,
  };
}

/**
 * Resolve the connected account used only by ImmoScout application calls.
 *
 * @param {Object} [options]
 * @param {string} options.userId Owning Fredy Firebase user id.
 * @param {string} options.accountEmail Authenticated Fredy login email.
 * @param {{get: Function, rotate: Function}} [options.credentialStore]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.now]
 * @returns {Promise<Object>}
 */
export async function getImmoscoutApplicationSession({
  userId,
  accountEmail,
  credentialStore = defaultCredentialStore,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const ownerId = typeof userId === 'string' ? userId.trim() : '';
  const email = normalizedEmail(accountEmail);
  if (!ownerId || !email) {
    throw new InquiryDeliveryError('ImmoScout account authentication requires a Fredy user and email.', {
      outcome: 'failed',
      phase: 'authentication',
      permanent: true,
    });
  }
  const cachedSession = cachedSessions.get(ownerId);
  if (cachedSession?.accountEmail === email && cachedSession.expiresAt - REFRESH_EARLY_MS > now) {
    return cachedSession;
  }
  const refreshInFlight = refreshesInFlight.get(ownerId);
  if (refreshInFlight?.email === email) return refreshInFlight.promise;
  if (refreshInFlight != null) {
    await refreshInFlight.promise;
    return getImmoscoutApplicationSession({ userId: ownerId, accountEmail, credentialStore, fetchImpl, now });
  }
  const promise = refreshSession({ userId: ownerId, accountEmail, credentialStore, fetchImpl, now })
    .then((session) => {
      cachedSessions.set(ownerId, session);
      return session;
    })
    .finally(() => {
      if (refreshesInFlight.get(ownerId)?.promise === promise) refreshesInFlight.delete(ownerId);
    });
  refreshesInFlight.set(ownerId, { email, promise });
  return promise;
}

export function resetImmoscoutApplicationSessionForTests() {
  cachedSessions.clear();
  refreshesInFlight.clear();
}
