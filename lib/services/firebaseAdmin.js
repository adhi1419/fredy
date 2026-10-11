/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Firebase Admin SDK wrapper — a lazy singleton exposing the direct bearer
 * verification seam used by authHook.
 *
 * Kept in its own module so tests can vi.mock a single seam instead of the
 * whole firebase-admin package. On Cloud Run, Application Default
 * Credentials identify the project; locally, the Firebase AUTH emulator is
 * honored via FIREBASE_AUTH_EMULATOR_HOST (handled natively by the SDK).
 */

import logger from './logger.js';

let app = null;
let appPromise = null;

async function getApp() {
  if (app) return app;
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const { initializeApp, applicationDefault } = await import('firebase-admin/app');
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
    return initializeApp({
      ...(projectId ? { projectId } : {}),
      credential: applicationDefault(),
    });
  })();
  try {
    app = await appPromise;
    return app;
  } finally {
    appPromise = null;
  }
}

/**
 * Verify a Firebase ID token and return its decoded claims.
 *
 * @param {string} idToken
 * @returns {Promise<{uid: string, email: string|null, email_verified: boolean, name?: string}>}
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

/**
 * Return an Application Default Credentials access token for server-side Google Cloud APIs.
 * The token never leaves the backend; callers use it only in Authorization headers to Google.
 *
 * @returns {Promise<string>}
 */
export async function getGoogleAccessToken() {
  const current = await getApp();
  const credential = current.options.credential;
  if (credential == null || typeof credential.getAccessToken !== 'function') {
    throw new Error('Application Default Credentials are unavailable');
  }
  const token = await credential.getAccessToken();
  if (typeof token?.access_token !== 'string' || token.access_token.length === 0) {
    throw new Error('Application Default Credentials returned no access token');
  }
  return token.access_token;
}
