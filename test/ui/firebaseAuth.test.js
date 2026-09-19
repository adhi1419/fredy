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

describe('Firebase auth initialization', () => {
  it('sets browser-local persistence and waits for restored auth state', async () => {
    const order = [];
    const auth = {
      currentUser: { uid: 'restored' },
      authStateReady: vi.fn(async () => order.push('state-ready')),
    };
    const setPersistence = vi.fn(async () => order.push('persistence'));

    vi.doMock('firebase/app', () => ({
      getApps: () => [],
      getApp: vi.fn(),
      initializeApp: vi.fn(() => ({ name: 'fredy' })),
    }));
    vi.doMock('firebase/auth', () => ({
      browserLocalPersistence: { type: 'LOCAL' },
      getAuth: () => auth,
      GoogleAuthProvider: class {},
      onAuthStateChanged: vi.fn(),
      setPersistence,
      signInWithPopup: vi.fn(),
      signOut: vi.fn(),
    }));
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
    const client = await authReady;

    expect(client.auth.currentUser.uid).toBe('restored');
    expect(setPersistence).toHaveBeenCalledOnce();
    expect(auth.authStateReady).toHaveBeenCalledOnce();
    expect(order).toEqual(['persistence', 'state-ready']);

    await signOutFirebase();
    expect(client.signOut).toHaveBeenCalledWith(auth);
  });
});
