/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Backend identity resolution — the deep module that turns a Firebase ID token into an
 * authenticated Fredy projection, or a stable domain failure reason.
 *
 * This module is transport-agnostic: it accepts an ID token string (never a Fastify request) and
 * returns a domain result (never an HTTP status code or response payload). The HTTP adapter in
 * `lib/api/security.js` owns bearer parsing and the mapping from these reasons to wire responses.
 */

import * as userStorage from '../storage/userStorage.js';
import { getAllowedUser } from '../storage/firestore/allowedUsersStorage.js';
import { verifyIdToken } from '../firebaseAdmin.js';

/**
 * Normalize a Firebase email claim for the allowlist lookup.
 * @param {unknown} email
 * @returns {string|null}
 */
export function normalizeVerifiedEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Stable domain failure reasons. The HTTP adapter maps each to its wire response; nothing outside
 * this module should branch on anything else.
 * @readonly
 * @enum {string}
 */
export const IdentityFailure = {
  INVALID_TOKEN: 'invalid_token',
  INVALID_CLAIMS: 'invalid_claims',
  NOT_ALLOWED: 'not_allowed',
};

/**
 * @typedef {{
 *   uid: string,
 *   email: string|null,
 *   email_verified: boolean,
 *   name?: string,
 * }} FirebaseClaims
 */

/**
 * @typedef {{
 *   id: string,
 *   username: string,
 *   isAdmin: boolean,
 * }} CurrentUser
 */

/**
 * @typedef {{ok: true, currentUser: CurrentUser}|{ok: false, reason: IdentityFailure}} IdentityResult
 */

/**
 * @typedef {{uid: string, email: string, displayName: string|null}} VerifiedIdentity
 */

/**
 * @typedef {{ok: true, identity: VerifiedIdentity}|{ok: false, reason: IdentityFailure}} VerifiedIdentityResult
 */

/**
 * Verify a Firebase ID token and project its claims, stopping before the allowlist. Shared by both
 * resolvers below so the verify+claims step has exactly one implementation.
 *
 * @param {string} idToken
 * @param {(idToken: string) => Promise<FirebaseClaims>} verifyToken
 * @returns {Promise<VerifiedIdentityResult>}
 */
async function verifyAndProjectClaims(idToken, verifyToken) {
  let decoded;
  try {
    decoded = await verifyToken(idToken);
  } catch {
    return { ok: false, reason: IdentityFailure.INVALID_TOKEN };
  }

  const uid = decoded?.uid;
  const email = normalizeVerifiedEmail(decoded?.email);
  if (typeof uid !== 'string' || uid.length === 0 || email == null || decoded?.email_verified !== true) {
    return { ok: false, reason: IdentityFailure.INVALID_CLAIMS };
  }

  const displayName = typeof decoded?.name === 'string' && decoded.name.length > 0 ? decoded.name : null;
  return { ok: true, identity: { uid, email, displayName } };
}

/**
 * Build the backend identity resolver. Dependencies are injectable so the security policy can be
 * tested without constructing Firebase or Firestore clients, while production uses the existing
 * lazy Firebase and Firestore seams.
 *
 * @param {{
 *   verifyToken?: (idToken: string) => Promise<FirebaseClaims>,
 *   getAllowedUser?: (email: string) => Promise<{email: string, isAdmin?: boolean}|null>,
 *   getUserIdentity?: (uid: string) => Promise<{id: string, username: string, isAdmin?: boolean}|null>,
 *   upsertUser?: (params: {userId: string, username: string, isAdmin: boolean}) => Promise<unknown>,
 * }} [dependencies]
 * @returns {(idToken: string) => Promise<IdentityResult>}
 */
export function createFirebaseIdentityResolver({
  verifyToken = verifyIdToken,
  getAllowedUser: lookupAllowedUser = getAllowedUser,
  getUserIdentity = userStorage.getUserIdentity,
  upsertUser = userStorage.upsertUser,
} = {}) {
  /**
   * Resolve a Firebase ID token into an authenticated Fredy projection.
   *
   * The token is the only client-supplied identity. The allowlist is read on every call so
   * revocation and admin changes take effect immediately; its result is also synchronized onto the
   * Fredy user whose id is the Firebase UID, but only when an identity field actually differs.
   *
   * @param {string} idToken
   * @returns {Promise<IdentityResult>}
   */
  return async function resolveFirebaseIdentity(idToken) {
    const verified = await verifyAndProjectClaims(idToken, verifyToken);
    if (!verified.ok) return verified;
    const { uid, email } = verified.identity;

    const allowed = await lookupAllowedUser(email);
    if (allowed == null) {
      return { ok: false, reason: IdentityFailure.NOT_ALLOWED };
    }

    const isAdmin = allowed.isAdmin === true;
    const existing = await getUserIdentity(uid);
    if (existing == null || existing.username !== email || existing.isAdmin !== isAdmin) {
      await upsertUser({ userId: uid, username: email, isAdmin });
    }

    return { ok: true, currentUser: { id: uid, username: email, isAdmin } };
  };
}

/** Production resolver using the existing Firebase Admin and Firestore seams. */
export const resolveFirebaseIdentity = createFirebaseIdentityResolver();

/**
 * Build the verified-identity resolver: verifies the token and projects claims exactly like
 * {@link createFirebaseIdentityResolver}, but stops before the allowlist lookup. Used by routes
 * that must authenticate a caller before knowing whether they are allowlisted - the access-request
 * waitlist being the first one.
 *
 * @param {{verifyToken?: (idToken: string) => Promise<FirebaseClaims>}} [dependencies]
 * @returns {(idToken: string) => Promise<VerifiedIdentityResult>}
 */
export function createVerifiedIdentityResolver({ verifyToken = verifyIdToken } = {}) {
  return async function resolveVerifiedIdentity(idToken) {
    return verifyAndProjectClaims(idToken, verifyToken);
  };
}

/** Production verified-identity resolver using the existing Firebase Admin seam. */
export const resolveVerifiedIdentity = createVerifiedIdentityResolver();
