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
  type Auth,
  setPersistence,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { resolveApiUrl } from '../apiUrl.js';

export interface FirebaseAuthIdentity {
  uid: string;
  email?: string | null;
  photoURL?: string | null;
}

/**
 * Accept a profile photo URL only when it is an absolute HTTPS URL. Firebase's Google provider
 * returns HTTPS avatar URLs; anything else (http, data:, javascript:, blob:, a relative path, or a
 * non-string) is rejected so the account trigger falls back to initials rather than rendering an
 * untrusted or mixed-content image.
 *
 * @param value The candidate photo URL from Firebase auth state.
 * @returns The URL when it is a safe HTTPS URL, otherwise null.
 */
export function safePhotoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export interface FirebaseAuthClient {
  enabled: boolean;
  auth: Auth;
  GoogleAuthProvider: typeof GoogleAuthProvider;
  onAuthStateChanged: typeof onAuthStateChanged;
  signInWithPopup: typeof signInWithPopup;
  signOut: typeof signOut;
}

/**
 * The Firebase client is initialized exactly once for the lifetime of this module. The config is
 * deliberately fetched without cookies or a bearer token: it is the public bootstrap endpoint
 * needed before a Firebase user exists.
 *
 * @returns
 */
async function createAuthClient(): Promise<FirebaseAuthClient | { enabled: false }> {
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
export const authReady: Promise<FirebaseAuthClient | { enabled: false }> = createAuthClient();

/**
 * Resolve the initialized Firebase client.
 * @returns
 */
export function getFirebaseAuthClient(): Promise<FirebaseAuthClient | { enabled: false }> {
  return authReady;
}

/**
 * Get the current Firebase user after initialization has completed.
 * @returns
 */
export async function getFirebaseCurrentUser(): Promise<FirebaseAuthIdentity | null> {
  const client = await authReady;
  return client.enabled ? (client.auth.currentUser as FirebaseAuthIdentity | null) : null;
}

/**
 * Get an ID token for the current user. Public requests are allowed to continue without one when
 * no Firebase user exists or auth initialization failed; protected endpoints will return 401.
 *
 * @param forceRefresh Force Firebase to refresh the token.
 * @returns
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const client = await authReady;
    if (!client.enabled) {
      return null;
    }
    const token = await client.auth.currentUser?.getIdToken(forceRefresh);
    return token ?? null;
  } catch {
    return null;
  }
}

/**
 * Sign out of Firebase directly. There is no backend session-cookie endpoint in bearer mode.
 * @returns
 */
export async function signOutFirebase(): Promise<void> {
  const client = await authReady;
  if (client.enabled && client.auth.currentUser) {
    await client.signOut(client.auth);
  }
}

/**
 * Subscribe to Firebase auth state after the singleton client is ready.
 * @param listener
 * @returns unsubscribe function
 */
export function subscribeToAuthState(listener: (user: FirebaseAuthIdentity | null) => void): () => void {
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
