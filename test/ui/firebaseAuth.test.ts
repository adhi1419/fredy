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

describe('safe profile photo URL policy', () => {
  it('accepts only absolute HTTPS URLs and rejects everything else', async () => {
    // Importing the module runs createAuthClient(), which fetches the bootstrap config once. Stub it
    // to a disabled config so the load resolves without a real network call.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ enabled: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const { safePhotoUrl } = await import('../../ui/src/services/auth/firebaseAuth.js');

    expect(safePhotoUrl('https://lh3.googleusercontent.com/a/x')).toBe('https://lh3.googleusercontent.com/a/x');
    expect(safePhotoUrl('  https://host/pic.png  ')).toBe('https://host/pic.png');

    for (const value of [
      null,
      undefined,
      42,
      '',
      '   ',
      'http://host/pic.png',
      'data:image/png;base64,AAAA',
      'blob:https://host/uuid',
      'javascript:alert(1)',
      '//host/pic.png',
      '/relative/pic.png',
    ]) {
      expect(safePhotoUrl(value)).toBeNull();
    }
  });
});
