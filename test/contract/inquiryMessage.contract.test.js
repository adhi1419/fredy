/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract test: setInquiryMessage / inquiry_message round-trip.
 *
 * The eager pipeline stores a generated inquiry draft on the listing; the
 * Telegram second message and the detail view read it back. Both backends
 * must round-trip it via getListingById and normalise empty -> null.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

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
    provider: ['immoscout'],
    notificationAdapter: [],
  });
});

afterAll(async () => {
  await teardownBackend();
});

async function seedListing() {
  const items = [{ id: 'hash-im-1', title: 'Flat', address: 'Berlin', price: 1200, size: 60, rooms: 2 }];
  await listingsStorage.storeListings('j1', 'immoscout', items);
  return items[0].id; // storeListings mutates id -> doc id
}

describe('setInquiryMessage contract', () => {
  it('stores and reads back the inquiry message via getListingById', async () => {
    const id = await seedListing();
    const changed = await listingsStorage.setInquiryMessage(id, 'Sehr geehrte Damen und Herren, ...');
    expect(changed).toBe(1);
    const row = await listingsStorage.getListingById(id, 'u1', true);
    expect(row.inquiry_message).toBe('Sehr geehrte Damen und Herren, ...');
  });

  it('is null by default before any message is stored', async () => {
    const id = await seedListing();
    const row = await listingsStorage.getListingById(id, 'u1', true);
    expect(row.inquiry_message == null).toBe(true);
  });

  it('normalises empty/whitespace to null (clear)', async () => {
    const id = await seedListing();
    await listingsStorage.setInquiryMessage(id, 'draft');
    await listingsStorage.setInquiryMessage(id, '   ');
    const row = await listingsStorage.getListingById(id, 'u1', true);
    expect(row.inquiry_message == null).toBe(true);
  });

  it('returns 0 for a missing/empty id', async () => {
    expect(await listingsStorage.setInquiryMessage('', 'x')).toBe(0);
    expect(await listingsStorage.setInquiryMessage(null, 'x')).toBe(0);
  });
});
