/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * accessRequests — the waitlist for verified identities that are not (yet) on the allowlist.
 *
 * One document per requesting email:
 *   access_requests/{email} -> { email, displayName, uid, requestedAt, status, decidedAt }
 *
 * Emails are normalized to lowercase and used RAW as the doc id, exactly like
 * `allowedUsersStorage.js` (see that file for why they are never URL-encoded).
 */

import FirestoreConnection from './FirestoreConnection.js';

const COLLECTION = 'access_requests';

const docId = (email) => String(email).trim().toLowerCase();

const col = () => FirestoreConnection.collection(COLLECTION);

/**
 * @typedef {{
 *   email: string,
 *   displayName: string|null,
 *   uid: string,
 *   requestedAt: number,
 *   status: 'pending'|'declined',
 *   decidedAt: number|null,
 * }} AccessRequest
 */

/**
 * @param {import('@google-cloud/firestore').DocumentSnapshot} snap
 * @returns {AccessRequest}
 */
function toRow(snap) {
  const d = snap.data();
  return {
    email: d.email,
    displayName: d.displayName ?? null,
    uid: d.uid,
    requestedAt: d.requestedAt,
    status: d.status,
    decidedAt: d.decidedAt ?? null,
  };
}

/**
 * Look an email up in the waitlist.
 * @param {string} email
 * @returns {Promise<AccessRequest|null>}
 */
export async function getAccessRequest(email) {
  if (!email || typeof email !== 'string') return null;
  const snap = await col().doc(docId(email)).get();
  return snap.exists ? toRow(snap) : null;
}

/**
 * Record a new access request, idempotently. An existing row - pending or declined - is returned
 * unchanged: a declined user re-requesting access must not silently become pending again, and a
 * pending user re-requesting must not reset their position or decision.
 *
 * @param {{email: string, displayName?: string|null, uid: string}} params
 * @returns {Promise<AccessRequest>}
 */
export async function createAccessRequest({ email, displayName = null, uid }) {
  const normalized = docId(email);
  const existing = await col().doc(normalized).get();
  if (existing.exists) return toRow(existing);

  const row = {
    email: normalized,
    displayName,
    uid,
    requestedAt: Date.now(),
    status: 'pending',
    decidedAt: null,
  };
  await col().doc(normalized).set(row);
  return row;
}

/**
 * List every access request, oldest first. Sorted in memory - with only pending and declined rows
 * ever created, this never grows large enough to need a composite index.
 * @returns {Promise<AccessRequest[]>}
 */
export async function listAccessRequests() {
  const snap = await col().get();
  return snap.docs.map(toRow).sort((a, b) => a.requestedAt - b.requestedAt);
}

/**
 * Decline a pending (or already-declined) request.
 * @param {string} email
 * @returns {Promise<AccessRequest|null>}
 */
export async function declineAccessRequest(email) {
  const normalized = docId(email);
  const ref = col().doc(normalized);
  const existing = await ref.get();
  if (!existing.exists) return null;
  await ref.update({ status: 'declined', decidedAt: Date.now() });
  return toRow(await ref.get());
}

/**
 * Remove a request (approved or otherwise disposed of).
 * @param {string} email
 */
export async function removeAccessRequest(email) {
  await col().doc(docId(email)).delete();
}
