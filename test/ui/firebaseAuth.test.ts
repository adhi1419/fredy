/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

interface MockFirebaseAuth {
  currentUser: { uid: string };
  authStateReady: () => Promise<void>;
}

interface MockFirebaseClient {
  enabled: boolean;
  auth: MockFirebaseAuth;
  signOut: (auth: MockFirebaseAuth) => Promise<void>;
}

interface MockFirebaseAuthModule {
  browserLocalPersistence: { type: 'LOCAL' };
  getAuth: () => MockFirebaseAuth;
  GoogleAuthProvider: new () => void;
  onAuthStateChanged: () => void;
  setPersistence: (auth: MockFirebaseAuth, persistence: unknown) => Promise<void>;
  signInWithPopup: () => void;
  signOut: () => void;
}

interface MockFirebaseAppModule {
  getApps: () => unknown[];
  getApp: () => void;
  initializeApp: (config: unknown) => { name: string };
}

describe('Firebase auth initialization', () => {
  it('sets browser-local persistence and waits for restored auth state', async () => {
    const order: string[] = [];
    const auth = {
      currentUser: { uid: 'restored' },
      authStateReady: vi.fn(async () => {
        order.push('state-ready');
        return undefined;
      }),
    } as MockFirebaseAuth;
    const setPersistence = vi.fn(async () => {
      order.push('persistence');
      return undefined;
    });

    vi.doMock(
      'firebase/app',
      () =>
        ({
          getApps: () => [],
          getApp: vi.fn(),
          initializeApp: vi.fn(() => ({ name: 'fredy' })),
        }) as MockFirebaseAppModule,
    );
    vi.doMock(
      'firebase/auth',
      () =>
        ({
          browserLocalPersistence: { type: 'LOCAL' },
          getAuth: () => auth,
          GoogleAuthProvider: class {},
          onAuthStateChanged: vi.fn(),
          setPersistence,
          signInWithPopup: vi.fn(),
          signOut: vi.fn(),
        }) as MockFirebaseAuthModule,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ enabled: true, firebaseConfig: { apiKey: 'key', projectId: 'fredy' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { authReady, signOutFirebase } = await import('../../ui/src/services/auth/firebaseAuth.js');
    const client = (await authReady) as MockFirebaseClient;

    expect(client.auth.currentUser.uid).toBe('restored');
    expect(setPersistence).toHaveBeenCalledOnce();
    expect(auth.authStateReady).toHaveBeenCalledOnce();
    expect(order).toEqual(['persistence', 'state-ready']);

    await signOutFirebase();
    expect(client.signOut).toHaveBeenCalledWith(auth);
  });
});
