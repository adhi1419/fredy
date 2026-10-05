/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initBackend, loadStorageModule, resetBackend, teardownBackend } from './harness.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
let credentialStorage;

beforeAll(async () => {
  process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY = `${KEY}\n`;
  await initBackend();
  credentialStorage = await loadStorageModule('providerCredentialStorage');
});

beforeEach(resetBackend);

afterAll(async () => {
  delete process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY;
  await teardownBackend();
});

describe('provider credential storage contract', () => {
  it('stores ciphertext and returns the decrypted owner-scoped secret', async () => {
    await credentialStorage.createProviderCredential({
      userId: 'user-1',
      providerId: 'immoscout',
      secret: 'refresh-token-1',
      now: 100,
    });

    const loaded = await credentialStorage.getProviderCredential('user-1', 'immoscout');
    expect(loaded).toEqual({ secret: 'refresh-token-1', revision: 1 });

    const { default: FirestoreConnection } =
      await import('../../lib/services/storage/firestore/FirestoreConnection.js');
    const snapshot = await FirestoreConnection.collection('provider_credentials').get();
    expect(snapshot.size).toBe(1);
    const stored = snapshot.docs[0].data();
    expect(stored).not.toHaveProperty('secret');
    expect(JSON.stringify(stored)).not.toContain('refresh-token-1');
    expect(stored).toMatchObject({
      userId: 'user-1',
      providerId: 'immoscout',
      algorithm: 'aes-256-gcm',
      keyVersion: 1,
      revision: 1,
    });
  });

  it('rotates only the revision that was read', async () => {
    await credentialStorage.createProviderCredential({
      userId: 'user-1',
      providerId: 'immoscout',
      secret: 'refresh-token-1',
    });
    await credentialStorage.rotateProviderCredential({
      userId: 'user-1',
      providerId: 'immoscout',
      secret: 'refresh-token-2',
      expectedRevision: 1,
    });

    await expect(
      credentialStorage.rotateProviderCredential({
        userId: 'user-1',
        providerId: 'immoscout',
        secret: 'stale-token',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('Provider credential changed during refresh.');
    await expect(credentialStorage.getProviderCredential('user-1', 'immoscout')).resolves.toEqual({
      secret: 'refresh-token-2',
      revision: 2,
    });
  });

  it('rejects the wrong encryption key without leaking ciphertext details', async () => {
    await credentialStorage.createProviderCredential({
      userId: 'user-1',
      providerId: 'immoscout',
      secret: 'refresh-token-1',
    });
    await expect(
      credentialStorage.getProviderCredential('user-1', 'immoscout', {
        key: Buffer.alloc(32, 8).toString('base64'),
      }),
    ).rejects.toThrow('Provider credential could not be decrypted.');
  });
});
