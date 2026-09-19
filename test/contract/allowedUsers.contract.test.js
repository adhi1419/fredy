/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: allowedUsersStorage (multi-tenant allowlist)
 *
 * Firestore-only: the allowlist exists solely for AUTH_MODE=firebase, which
 * requires the firestore backend (index.js refuses any other combination).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, backendName } from './harness.js';

const firestoreOnly = describe.skipIf(backendName() !== 'firestore');

let allowedUsers;

firestoreOnly('allowedUsersStorage contract', () => {
  beforeAll(async () => {
    await initBackend();
    allowedUsers = await import('../../lib/services/storage/firestore/allowedUsersStorage.js');
  });

  beforeEach(async () => {
    await resetBackend();
  });

  afterAll(async () => {
    await teardownBackend();
  });

  it('returns null for an email that is not on the allowlist', async () => {
    expect(await allowedUsers.getAllowedUser('nobody@example.com')).toBeNull();
  });

  it('returns null for missing/invalid input', async () => {
    expect(await allowedUsers.getAllowedUser(null)).toBeNull();
    expect(await allowedUsers.getAllowedUser(undefined)).toBeNull();
    expect(await allowedUsers.getAllowedUser('')).toBeNull();
  });

  it('round-trips an entry with isAdmin flag', async () => {
    await allowedUsers.upsertAllowedUser({ email: 'admin@example.com', isAdmin: true });
    const entry = await allowedUsers.getAllowedUser('admin@example.com');
    expect(entry.email).toBe('admin@example.com');
    expect(entry.isAdmin).toBe(true);
    expect(entry.addedAt).toBeGreaterThan(0);
  });

  it('defaults isAdmin to false', async () => {
    await allowedUsers.upsertAllowedUser({ email: 'friend@example.com' });
    expect((await allowedUsers.getAllowedUser('friend@example.com')).isAdmin).toBe(false);
  });

  it('normalizes email case and whitespace on both write and read', async () => {
    await allowedUsers.upsertAllowedUser({ email: '  Friend@Example.COM ' });
    const entry = await allowedUsers.getAllowedUser('friend@example.com');
    expect(entry).not.toBeNull();
    expect(entry.email).toBe('friend@example.com');
    // Lookup with different casing also hits.
    expect(await allowedUsers.getAllowedUser('FRIEND@example.com')).not.toBeNull();
  });

  it('upsert updates an existing entry in place (promote to admin)', async () => {
    await allowedUsers.upsertAllowedUser({ email: 'friend@example.com', isAdmin: false });
    await allowedUsers.upsertAllowedUser({ email: 'friend@example.com', isAdmin: true });
    expect((await allowedUsers.getAllowedUser('friend@example.com')).isAdmin).toBe(true);
  });

  it('removeAllowedUser revokes the entry', async () => {
    await allowedUsers.upsertAllowedUser({ email: 'gone@example.com' });
    await allowedUsers.removeAllowedUser('gone@example.com');
    expect(await allowedUsers.getAllowedUser('gone@example.com')).toBeNull();
  });
});
