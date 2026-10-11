/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();
vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const accessRequests = await import('../../../lib/services/storage/firestore/accessRequestsStorage.js');

beforeEach(() => {
  firestore.clear();
});

describe('accessRequestsStorage', () => {
  it('returns null for an email with no request, and for missing/invalid input', async () => {
    expect(await accessRequests.getAccessRequest('nobody@example.com')).toBeNull();
    expect(await accessRequests.getAccessRequest(null)).toBeNull();
    expect(await accessRequests.getAccessRequest(undefined)).toBeNull();
    expect(await accessRequests.getAccessRequest('')).toBeNull();
  });

  it('creates a pending row with the given identity', async () => {
    const row = await accessRequests.createAccessRequest({
      email: 'Alice@Example.COM',
      displayName: 'Alice',
      uid: 'uid-alice',
    });

    expect(row).toMatchObject({
      email: 'alice@example.com',
      displayName: 'Alice',
      uid: 'uid-alice',
      status: 'pending',
      decidedAt: null,
    });
    expect(row.requestedAt).toBeGreaterThan(0);
    expect(await accessRequests.getAccessRequest('alice@example.com')).toEqual(row);
  });

  it('normalizes email case and whitespace for the doc id', async () => {
    await accessRequests.createAccessRequest({ email: '  Bob@Example.COM ', uid: 'uid-bob' });
    expect(await accessRequests.getAccessRequest('bob@example.com')).not.toBeNull();
    expect(await accessRequests.getAccessRequest('BOB@example.com')).not.toBeNull();
  });

  it('defaults displayName to null when omitted', async () => {
    const row = await accessRequests.createAccessRequest({ email: 'noname@example.com', uid: 'uid-noname' });
    expect(row.displayName).toBeNull();
  });

  it('creating a request twice returns the existing row unchanged, not a reset', async () => {
    const first = await accessRequests.createAccessRequest({ email: 'carol@example.com', uid: 'uid-carol' });
    const second = await accessRequests.createAccessRequest({
      email: 'carol@example.com',
      uid: 'different-uid',
      displayName: 'Someone else',
    });
    expect(second).toEqual(first);
  });

  it('re-requesting after a decline stays declined, not pending again', async () => {
    await accessRequests.createAccessRequest({ email: 'dana@example.com', uid: 'uid-dana' });
    await accessRequests.declineAccessRequest('dana@example.com');

    const reRequested = await accessRequests.createAccessRequest({ email: 'dana@example.com', uid: 'uid-dana' });

    expect(reRequested.status).toBe('declined');
    expect(await accessRequests.getAccessRequest('dana@example.com')).toMatchObject({ status: 'declined' });
  });

  it('lists all requests ordered by requestedAt ascending', async () => {
    await accessRequests.createAccessRequest({ email: 'first@example.com', uid: 'uid-1' });
    await accessRequests.createAccessRequest({ email: 'second@example.com', uid: 'uid-2' });
    await accessRequests.declineAccessRequest('second@example.com');
    await accessRequests.createAccessRequest({ email: 'third@example.com', uid: 'uid-3' });

    const requests = await accessRequests.listAccessRequests();

    expect(requests.map((r) => r.email)).toEqual(['first@example.com', 'second@example.com', 'third@example.com']);
    expect(requests.map((r) => r.status)).toEqual(['pending', 'declined', 'pending']);
  });

  it('declining a request sets status and decidedAt, and returns null for an absent email', async () => {
    await accessRequests.createAccessRequest({ email: 'erin@example.com', uid: 'uid-erin' });

    const declined = await accessRequests.declineAccessRequest('erin@example.com');

    expect(declined.status).toBe('declined');
    expect(declined.decidedAt).toBeGreaterThan(0);
    expect(await accessRequests.declineAccessRequest('absent@example.com')).toBeNull();
  });

  it('removeAccessRequest deletes the row, idempotently', async () => {
    await accessRequests.createAccessRequest({ email: 'frank@example.com', uid: 'uid-frank' });

    await accessRequests.removeAccessRequest('frank@example.com');
    expect(await accessRequests.getAccessRequest('frank@example.com')).toBeNull();

    await expect(accessRequests.removeAccessRequest('frank@example.com')).resolves.toBeUndefined();
  });
});
