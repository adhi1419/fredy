/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * sessionStore — Firestore implementation.
 *
 * Data model: collection `sessions`, doc id = sid,
 * fields { data (JSON string), expiresAt (epoch ms) }.
 */

import FirestoreConnection from './FirestoreConnection.js';
import logger from '../../logger.js';

const COLLECTION = 'sessions';
const DEFAULT_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * When the row may be deleted, taken from the session cookie's own expiry.
 */
function expiryOf(session) {
  const cookie = session?.cookie;
  if (cookie?.expires != null) {
    const asDate = cookie.expires instanceof Date ? cookie.expires : new Date(cookie.expires);
    const time = asDate.getTime();
    if (Number.isFinite(time)) return time;
  }
  const maxAge = Number(cookie?.originalMaxAge ?? cookie?.maxAge);
  return Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : DEFAULT_ROW_TTL_MS);
}

export class SessionStore {
  set(sessionId, session, callback) {
    FirestoreConnection.collection(COLLECTION)
      .doc(sessionId)
      .set({ data: JSON.stringify(session), expiresAt: expiryOf(session) })
      .then(() => callback())
      .catch((error) => {
        logger.error('Failed to persist session', error);
        callback(error);
      });
  }

  get(sessionId, callback) {
    const ref = FirestoreConnection.collection(COLLECTION).doc(sessionId);
    ref
      .get()
      .then(async (snap) => {
        if (!snap.exists) return callback(null, null);
        const row = snap.data();
        if (Number(row.expiresAt) <= Date.now()) {
          await ref.delete();
          return callback(null, null);
        }
        callback(null, JSON.parse(row.data));
      })
      .catch((error) => {
        logger.error('Failed to read session', error);
        callback(error);
      });
  }

  destroy(sessionId, callback) {
    FirestoreConnection.collection(COLLECTION)
      .doc(sessionId)
      .delete()
      .then(() => callback())
      .catch((error) => {
        logger.error('Failed to destroy session', error);
        callback(error);
      });
  }
}

/**
 * Delete every expired session document.
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>} How many documents were removed.
 */
export async function sweepExpiredSessions(now = Date.now()) {
  try {
    const snapshot = await FirestoreConnection.collection(COLLECTION).where('expiresAt', '<=', now).get();
    if (snapshot.empty) return 0;
    const batch = FirestoreConnection.getConnection().batch();
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return snapshot.size;
  } catch (error) {
    logger.warn('Failed to sweep expired sessions', error?.message || error);
    return 0;
  }
}
