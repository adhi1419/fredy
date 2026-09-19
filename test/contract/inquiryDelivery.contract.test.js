/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initBackend, loadStorageModule, resetBackend, teardownBackend } from './harness.js';

let listingsStorage;
let userStorage;
let jobStorage;

beforeAll(async () => {
  await initBackend();
  listingsStorage = await loadStorageModule('listingsStorage');
  userStorage = await loadStorageModule('userStorage');
  jobStorage = await loadStorageModule('jobStorage');
});

beforeEach(async () => {
  await resetBackend();
  await userStorage.upsertUser({ userId: 'u1', username: 'u1@example.com', isAdmin: true });
  await jobStorage.upsertJob({
    jobId: 'j1',
    name: 'J1',
    userId: 'u1',
    provider: [{ id: 'immoscout', url: 'https://example.com' }],
    notificationAdapter: [],
  });
});

afterAll(async () => {
  await teardownBackend();
});

async function seedListing() {
  const items = [
    {
      id: 'hash-1',
      title: 'Flat',
      address: 'Berlin',
      link: 'https://www.immobilienscout24.de/expose/170874105',
    },
  ];
  await listingsStorage.storeListings('j1', 'immoscout', items);
  return items[0].id;
}

describe('inquiry delivery storage contract', () => {
  it('reserves once and exposes the sending state', async () => {
    const id = await seedListing();
    expect(await listingsStorage.reserveInquirySend(id, 1234)).toBe(true);
    expect(await listingsStorage.reserveInquirySend(id, 1235)).toBe(false);
    const row = await listingsStorage.getListingById(id, 'u1', true);
    expect(row.inquiry_send_status).toBe('sending');
    expect(row.inquiry_send_started_at).toBe(1234);
  });

  it('records a confirmed send and never reserves it again', async () => {
    const id = await seedListing();
    await listingsStorage.reserveInquirySend(id, 1234);
    expect(await listingsStorage.finishInquirySend(id, { status: 'sent', requestId: 'request-1', sentAt: 5678 })).toBe(
      1,
    );
    const row = await listingsStorage.getListingById(id, 'u1', true);
    expect(row).toMatchObject({
      inquiry_send_status: 'sent',
      inquiry_request_id: 'request-1',
      inquiry_sent_at: 5678,
    });
    expect(await listingsStorage.reserveInquirySend(id)).toBe(false);
  });

  it('allows an explicit failed attempt to be reserved manually later', async () => {
    const id = await seedListing();
    await listingsStorage.reserveInquirySend(id);
    await listingsStorage.finishInquirySend(id, { status: 'failed', error: 'Missing email' });
    expect(await listingsStorage.reserveInquirySend(id)).toBe(true);
  });

  it('never reserves an unknown outcome again', async () => {
    const id = await seedListing();
    await listingsStorage.reserveInquirySend(id);
    await listingsStorage.finishInquirySend(id, { status: 'unknown', error: 'Connection closed' });
    expect(await listingsStorage.reserveInquirySend(id)).toBe(false);
  });

  it('rejects invalid terminal states', async () => {
    const id = await seedListing();
    await listingsStorage.reserveInquirySend(id);
    await expect(
      Promise.resolve().then(() => listingsStorage.finishInquirySend(id, { status: 'sending' })),
    ).rejects.toThrow(/Invalid inquiry send status/);
  });
});
