/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * allowedUsers — the multi-tenant allowlist (Firestore only).
 *
 * One document per approved email, manually managed:
 *   allowed_users/{encodedEmail} -> { email, isAdmin, addedAt }
 *
 * Emails are normalized to lowercase; the doc id is the encoded email so
 * lookups are a single point read.
 */

import FirestoreConnection from './FirestoreConnection.js';

const COLLECTION = 'allowed_users';

const docId = (email) => encodeURIComponent(String(email).trim().toLowerCase());

const col = () => FirestoreConnection.collection(COLLECTION);

/**
 * Look an email up in the allowlist.
 * @param {string} email
 * @returns {Promise<{email: string, isAdmin: boolean, addedAt: number}|null>}
 */
export async function getAllowedUser(email) {
  if (!email || typeof email !== 'string') return null;
  const snap = await col().doc(docId(email)).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return { email: d.email, isAdmin: !!d.isAdmin, addedAt: d.addedAt ?? null };
}

/**
 * Add or update an allowlist entry. Used by tests and by operators via a
 * one-off script; there is deliberately no admin UI (see PRD non-goals).
 * @param {{email: string, isAdmin?: boolean}} params
 */
export async function upsertAllowedUser({ email, isAdmin = false }) {
  const normalized = String(email).trim().toLowerCase();
  await col().doc(docId(normalized)).set({ email: normalized, isAdmin: !!isAdmin, addedAt: Date.now() });
}

/**
 * Remove an allowlist entry. Existing sessions live until TTL (accepted in
 * the PRD non-goals).
 * @param {string} email
 */
export async function removeAllowedUser(email) {
  await col().doc(docId(email)).delete();
}
