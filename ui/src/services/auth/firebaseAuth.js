/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { resolveApiUrl } from '../apiUrl.js';

/**
 * The Firebase client is initialized exactly once for the lifetime of this module. The config is
 * deliberately fetched without cookies or a bearer token: it is the public bootstrap endpoint
 * needed before a Firebase user exists.
 *
 * @returns {Promise<Object>}
 */
async function createAuthClient() {
  const response = await fetch(resolveApiUrl('/api/auth/config'), {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Firebase auth config failed with status ${response.status}`);
  }

  const config = await response.json();
  if (config?.enabled === false) {
    return { enabled: false };
  }

  const firebaseConfig = config?.firebaseConfig ?? config?.config ?? config;
  if (!firebaseConfig || typeof firebaseConfig !== 'object' || !firebaseConfig.apiKey) {
    throw new Error('Firebase auth configuration is missing');
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);

  // This must complete before the login button can call signInWithPopup. Without it, a reload can
  // lose the Firebase session, especially when the app and Firebase authDomain are cross-origin.
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();

  return {
    enabled: true,
    auth,
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut,
  };
}

/** A single promise shared by the login screen, request helpers, and SSE client. */
export const authReady = createAuthClient();

/**
 * Resolve the initialized Firebase client.
 * @returns {Promise<Object>}
 */
export function getFirebaseAuthClient() {
  return authReady;
}

/**
 * Get the current Firebase user after initialization has completed.
 * @returns {Promise<Object|null>}
 */
export async function getFirebaseCurrentUser() {
  const client = await authReady;
  return client.enabled ? client.auth.currentUser : null;
}

/**
 * Get an ID token for the current user. Public requests are allowed to continue without one when
 * no Firebase user exists or auth initialization failed; protected endpoints will return 401.
 *
 * @param {boolean} [forceRefresh=false] Force Firebase to refresh the token.
 * @returns {Promise<string|null>}
 */
export async function getIdToken(forceRefresh = false) {
  try {
    const user = await getFirebaseCurrentUser();
    return user ? await user.getIdToken(forceRefresh) : null;
  } catch {
    return null;
  }
}

/**
 * Sign out of Firebase directly. There is no backend session-cookie endpoint in bearer mode.
 * @returns {Promise<void>}
 */
export async function signOutFirebase() {
  const client = await authReady;
  if (client.enabled && client.auth.currentUser) {
    await client.signOut(client.auth);
  }
}

/**
 * Subscribe to Firebase auth state after the singleton client is ready.
 * @param {(user: Object|null) => void} listener
 * @returns {() => void} unsubscribe function
 */
export function subscribeToAuthState(listener) {
  let cancelled = false;
  let unsubscribe = () => {};

  authReady
    .then((client) => {
      if (cancelled) return;
      if (!client.enabled) {
        listener(null);
        return;
      }
      unsubscribe = client.onAuthStateChanged(client.auth, listener);
    })
    .catch(() => {
      if (!cancelled) listener(null);
    });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
