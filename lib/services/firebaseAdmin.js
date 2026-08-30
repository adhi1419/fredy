/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Firebase Admin SDK wrapper — a lazy singleton exposing exactly what the
 * login exchange needs: verifyIdToken.
 *
 * Kept in its own module so tests can vi.mock a single seam instead of the
 * whole firebase-admin package. On Cloud Run, Application Default
 * Credentials identify the project; locally, the Firebase AUTH emulator is
 * honored via FIREBASE_AUTH_EMULATOR_HOST (handled natively by the SDK).
 */

import logger from './logger.js';

let app = null;

async function getApp() {
  if (app) return app;
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  app = initializeApp({
    ...(projectId ? { projectId } : {}),
    credential: applicationDefault(),
  });
  return app;
}

/**
 * Verify a Firebase ID token and return its decoded claims.
 *
 * @param {string} idToken
 * @returns {Promise<{uid: string, email: string|null, email_verified?: boolean, name?: string}>}
 * @throws When the token is missing, malformed, expired, or has a bad signature.
 */
export async function verifyIdToken(idToken) {
  const { getAuth } = await import('firebase-admin/auth');
  const auth = getAuth(await getApp());
  try {
    return await auth.verifyIdToken(idToken);
  } catch (err) {
    logger.debug('Firebase ID token verification failed:', err?.code ?? err?.message);
    throw err;
  }
}
