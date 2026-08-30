/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * mcpOAuthStorage — Firestore implementation.
 *
 * Same public API as the SQLite version (lib/mcp/mcpOAuthStorage.js).
 * Four collections, one per SQLite table:
 *   mcp_oauth_clients, mcp_oauth_authorization_codes,
 *   mcp_oauth_access_tokens, mcp_oauth_refresh_tokens.
 *
 * Single-use / atomic semantics (redeem, refresh-rotate, revoke-family) use
 * Firestore transactions to replicate the SQLite withTransaction behavior.
 */

import crypto from 'crypto';
import { nanoid } from 'nanoid';
import FirestoreConnection from './FirestoreConnection.js';

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNUSED_CLIENT_TTL_MS = 60 * 60 * 1000;

const CLIENTS = 'mcp_oauth_clients';
const CODES = 'mcp_oauth_authorization_codes';
const ACCESS = 'mcp_oauth_access_tokens';
const REFRESH = 'mcp_oauth_refresh_tokens';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');

const db = () => FirestoreConnection.getConnection();
const col = (name) => FirestoreConnection.collection(name);

// ---------------------------------------------------------------------------
// Client registration
// ---------------------------------------------------------------------------

/** @param {{clientName?: string, redirectUris: string[]}} client */
export async function createClient({ clientName, redirectUris }) {
  const clientId = nanoid(32);
  await col(CLIENTS)
    .doc(clientId)
    .set({
      name: clientName ?? null,
      redirectUris: JSON.stringify(redirectUris),
      createdAt: Date.now(),
    });
  return { clientId, redirectUris };
}

/** @param {string} clientId */
export async function getClient(clientId) {
  const snap = await col(CLIENTS).doc(clientId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return { clientId: snap.id, redirectUris: JSON.parse(data.redirectUris) };
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

/** @param {{clientId: string, userId: string, redirectUri: string, codeChallenge: string, resource: string, scopes: string[]}} params */
export async function createAuthorizationCode(params) {
  const code = secret();
  await col(CODES)
    .doc(hash(code))
    .set({
      clientId: params.clientId,
      userId: params.userId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      resource: params.resource,
      scopes: JSON.stringify(params.scopes),
      expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_MS,
    });
  return code;
}

/** @param {{code: string, clientId: string, redirectUri: string, codeVerifier: string}} params */
export async function redeemAuthorizationCode(params) {
  const codeHash = hash(params.code);
  return db().runTransaction(async (txn) => {
    const codeRef = col(CODES).doc(codeHash);
    const snap = await txn.get(codeRef);
    if (!snap.exists) return null;

    const row = snap.data();
    if (row.expiresAt <= Date.now() || row.clientId !== params.clientId || row.redirectUri !== params.redirectUri) {
      return null;
    }

    const verifierHash = crypto.createHash('sha256').update(params.codeVerifier).digest('base64url');
    if (verifierHash.length !== row.codeChallenge.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(verifierHash), Buffer.from(row.codeChallenge))) return null;

    // Consume the code (single-use).
    txn.delete(codeRef);

    // Issue tokens within the same transaction.
    return issueTokens(txn, {
      clientId: row.clientId,
      userId: row.userId,
      resource: row.resource,
      scopes: JSON.parse(row.scopes),
      familyId: nanoid(),
    });
  });
}

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

/** @param {string} token @param {string} resource */
export async function validateAccessToken(token, resource) {
  const snap = await col(ACCESS).doc(hash(token)).get();
  if (!snap.exists) return null;
  const row = snap.data();
  if (row.resource !== resource || row.expiresAt <= Date.now() || row.revokedAt != null) return null;
  const scopes = JSON.parse(row.scopes);
  return scopes.includes('mcp:read') ? { userId: row.userId, scopes } : null;
}

// ---------------------------------------------------------------------------
// Refresh token rotation
// ---------------------------------------------------------------------------

/**
 * Rotate a refresh token. Replay detection revokes the whole family.
 * @param {{refreshToken: string, clientId: string}} params
 */
export async function refreshAccessToken(params) {
  const tokenHash = hash(params.refreshToken);
  return db().runTransaction(async (txn) => {
    const ref = col(REFRESH).doc(tokenHash);
    const snap = await txn.get(ref);
    if (!snap.exists) return null;

    const row = snap.data();
    const needsRevoke = row.clientId !== params.clientId || row.expiresAt <= Date.now() || row.revokedAt != null;

    // Firestore requires all reads before any writes. Pre-fetch the family
    // docs we might need to revoke, whether for theft detection or for the
    // normal case (we'll write to them after all reads are done).
    let familyDocs = [];
    if (row.familyId) {
      familyDocs = await gatherFamilyDocs(txn, [row.familyId]);
    }

    if (needsRevoke) {
      // Replay or mismatch — revoke the whole family (writes only).
      applyRevocations(txn, familyDocs);
      return null;
    }

    // Mark the old refresh token as revoked.
    txn.update(ref, { revokedAt: Date.now() });

    return issueTokens(txn, {
      clientId: row.clientId,
      userId: row.userId,
      resource: row.resource,
      scopes: JSON.parse(row.scopes),
      familyId: row.familyId,
    });
  });
}

// ---------------------------------------------------------------------------
// Grants (listing + revocation)
// ---------------------------------------------------------------------------

/**
 * List the clients a user has approved (alive grants = non-revoked, non-expired refresh tokens).
 * @param {string} userId
 * @returns {Promise<Array<{clientId: string, clientName: string|null, grantedAt: number}>>}
 */
export async function listGrants(userId) {
  const now = Date.now();
  const snapshot = await col(REFRESH).where('userId', '==', userId).where('revokedAt', '==', null).get();

  // Group by clientId, find earliest createdAt per client.
  const byClient = new Map();
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.expiresAt <= now) continue;
    const prev = byClient.get(d.clientId);
    if (!prev || d.createdAt < prev.createdAt) {
      byClient.set(d.clientId, d);
    }
  }

  // Fetch client names.
  const results = [];
  for (const [clientId, data] of byClient) {
    const clientSnap = await col(CLIENTS).doc(clientId).get();
    results.push({
      clientId,
      clientName: clientSnap.exists ? clientSnap.data().name : null,
      grantedAt: data.createdAt,
    });
  }

  // Order by grantedAt DESC (matching the sqlite ORDER BY grantedAt DESC).
  results.sort((a, b) => b.grantedAt - a.grantedAt);
  return results;
}

/**
 * Revoke a user's grant to a specific client (all families).
 * @param {string} userId
 * @param {string} clientId
 * @returns {Promise<boolean>}
 */
export async function revokeGrant(userId, clientId) {
  const now = Date.now();
  const snapshot = await col(REFRESH)
    .where('userId', '==', userId)
    .where('clientId', '==', clientId)
    .where('revokedAt', '==', null)
    .get();

  const familyIds = new Set();
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.expiresAt > now) familyIds.add(d.familyId);
  }

  if (familyIds.size === 0) return false;

  // Gather all docs first (reads), then apply revocations (writes).
  const familyDocs = await gatherFamilyDocsOutsideTxn([...familyIds]);
  const batch = db().batch();
  for (const doc of familyDocs) {
    if (doc.data().revokedAt == null) {
      batch.update(doc.ref, { revokedAt: now });
    }
  }
  await batch.commit();
  return true;
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

/**
 * Drop expired codes/tokens and orphaned clients.
 * @param {number} [now]
 * @returns {Promise<number>}
 */
export async function sweepExpired(now = Date.now()) {
  let removed = 0;

  // Expired codes.
  const codes = await col(CODES).where('expiresAt', '<=', now).get();
  if (!codes.empty) {
    const batch = db().batch();
    codes.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += codes.size;
  }

  // Expired access tokens.
  const access = await col(ACCESS).where('expiresAt', '<=', now).get();
  if (!access.empty) {
    const batch = db().batch();
    access.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += access.size;
  }

  // Expired refresh tokens.
  const refresh = await col(REFRESH).where('expiresAt', '<=', now).get();
  if (!refresh.empty) {
    const batch = db().batch();
    refresh.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += refresh.size;
  }

  // Orphaned clients: created before the grace window and with no remaining
  // codes, access tokens, or refresh tokens.
  const clientCutoff = now - UNUSED_CLIENT_TTL_MS;
  const clients = await col(CLIENTS).where('createdAt', '<=', clientCutoff).get();
  for (const clientDoc of clients.docs) {
    const cid = clientDoc.id;
    const hasCode = !(await col(CODES).where('clientId', '==', cid).limit(1).get()).empty;
    if (hasCode) continue;
    const hasAccess = !(await col(ACCESS).where('clientId', '==', cid).limit(1).get()).empty;
    if (hasAccess) continue;
    const hasRefresh = !(await col(REFRESH).where('clientId', '==', cid).limit(1).get()).empty;
    if (hasRefresh) continue;
    await clientDoc.ref.delete();
    removed += 1;
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Gather all docs in the given token families (reads only, for use inside a txn).
 * @param {FirebaseFirestore.Transaction} txn
 * @param {string[]} familyIds
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot[]>}
 */
async function gatherFamilyDocs(txn, familyIds) {
  const docs = [];
  for (const fid of familyIds) {
    for (const collection of [REFRESH, ACCESS]) {
      const snap = await txn.get(col(collection).where('familyId', '==', fid));
      docs.push(...snap.docs);
    }
  }
  return docs;
}

/**
 * Gather family docs outside a transaction (for batch writes).
 * @param {string[]} familyIds
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot[]>}
 */
async function gatherFamilyDocsOutsideTxn(familyIds) {
  const docs = [];
  for (const fid of familyIds) {
    for (const collection of [REFRESH, ACCESS]) {
      const snap = await col(collection).where('familyId', '==', fid).get();
      docs.push(...snap.docs);
    }
  }
  return docs;
}

/**
 * Apply revocation writes to pre-fetched family docs (writes only).
 * @param {FirebaseFirestore.Transaction} txn
 * @param {FirebaseFirestore.QueryDocumentSnapshot[]} docs
 */
function applyRevocations(txn, docs) {
  const now = Date.now();
  for (const doc of docs) {
    if (doc.data().revokedAt == null) {
      txn.update(doc.ref, { revokedAt: now });
    }
  }
}

/**
 * Issue an access + refresh token pair (within a transaction).
 * @param {FirebaseFirestore.Transaction} txn
 * @param {{clientId: string, userId: string, resource: string, scopes: string[], familyId: string}} params
 */
function issueTokens(txn, params) {
  const accessToken = secret();
  const refreshToken = secret();
  const now = Date.now();

  const tokenDoc = (collectionName, token, ttl) => {
    txn.set(col(collectionName).doc(hash(token)), {
      familyId: params.familyId,
      clientId: params.clientId,
      userId: params.userId,
      resource: params.resource,
      scopes: JSON.stringify(params.scopes),
      createdAt: now,
      expiresAt: now + ttl,
      revokedAt: null,
    });
  };

  tokenDoc(ACCESS, accessToken, ACCESS_TOKEN_TTL_MS);
  tokenDoc(REFRESH, refreshToken, REFRESH_TOKEN_TTL_MS);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
    scopes: params.scopes,
  };
}
