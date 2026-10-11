/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: accessRequestsStorage (the allowlist waitlist)
 *
 * Firestore-only, mirroring allowedUsers.contract.test.js: the waitlist is read/written by the
 * same Firestore backend as the allowlist it feeds into.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let accessRequests;

describe('accessRequestsStorage contract', () => {
  beforeAll(async () => {
    await initBackend();
    accessRequests = await import('../../lib/services/storage/firestore/accessRequestsStorage.js');
  });

  beforeEach(async () => {
    await resetBackend();
  });

  afterAll(async () => {
    await teardownBackend();
  });

  it('returns null for an email with no request', async () => {
    expect(await accessRequests.getAccessRequest('nobody@example.com')).toBeNull();
  });

  it('returns null for missing/invalid input', async () => {
    expect(await accessRequests.getAccessRequest(null)).toBeNull();
    expect(await accessRequests.getAccessRequest(undefined)).toBeNull();
    expect(await accessRequests.getAccessRequest('')).toBeNull();
  });

  it('creates a pending row and round-trips it', async () => {
    const created = await accessRequests.createAccessRequest({
      email: 'admin@example.com',
      displayName: 'Admin',
      uid: 'uid-admin',
    });
    expect(created.status).toBe('pending');
    expect(created.decidedAt).toBeNull();

    const fetched = await accessRequests.getAccessRequest('admin@example.com');
    expect(fetched).toEqual(created);
  });

  it('normalizes email case and whitespace on both write and read', async () => {
    await accessRequests.createAccessRequest({ email: '  Friend@Example.COM ', uid: 'uid-friend' });
    const entry = await accessRequests.getAccessRequest('friend@example.com');
    expect(entry).not.toBeNull();
    expect(entry.email).toBe('friend@example.com');
    expect(await accessRequests.getAccessRequest('FRIEND@example.com')).not.toBeNull();
  });

  it('creating a request twice does not reset an existing (including declined) row', async () => {
    const first = await accessRequests.createAccessRequest({ email: 'carol@example.com', uid: 'uid-carol' });
    await expect(accessRequests.createAccessRequest({ email: 'carol@example.com', uid: 'uid-carol' })).resolves.toEqual(
      first,
    );

    await accessRequests.declineAccessRequest('carol@example.com');
    const afterDecline = await accessRequests.getAccessRequest('carol@example.com');
    await expect(accessRequests.createAccessRequest({ email: 'carol@example.com', uid: 'uid-carol' })).resolves.toEqual(
      afterDecline,
    );
  });

  it('listAccessRequests returns every row, requestedAt ascending', async () => {
    await accessRequests.createAccessRequest({ email: 'first@example.com', uid: 'uid-1' });
    await accessRequests.createAccessRequest({ email: 'second@example.com', uid: 'uid-2' });

    const requests = await accessRequests.listAccessRequests();
    expect(requests.map((r) => r.email)).toEqual(['first@example.com', 'second@example.com']);
  });

  it('declineAccessRequest sets status and decidedAt; returns null for an absent email', async () => {
    await accessRequests.createAccessRequest({ email: 'gone@example.com', uid: 'uid-gone' });
    const declined = await accessRequests.declineAccessRequest('gone@example.com');
    expect(declined.status).toBe('declined');
    expect(declined.decidedAt).toBeGreaterThan(0);
    expect(await accessRequests.declineAccessRequest('absent@example.com')).toBeNull();
  });

  it('removeAccessRequest deletes the row', async () => {
    await accessRequests.createAccessRequest({ email: 'remove-me@example.com', uid: 'uid-remove' });
    await accessRequests.removeAccessRequest('remove-me@example.com');
    expect(await accessRequests.getAccessRequest('remove-me@example.com')).toBeNull();
  });
});
