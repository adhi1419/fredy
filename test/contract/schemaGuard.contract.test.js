/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Schema guard: writes through the real storage seams and asserts the raw Firestore document has
 * exactly the canonical shape. A reintroduced legacy key (listing `status`, job
 * `autoSendInquiry`, user `password` / `mcpToken`, settings `create_date`) fails here instead of
 * quietly growing a second data shape in production.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';
import FirestoreConnection from '../../lib/services/storage/firestore/FirestoreConnection.js';

let jobStorage;
let userStorage;
let listingsStorage;
let settingsStorage;

const raw = async (collection, id) =>
  (await FirestoreConnection.getConnection().collection(collection).doc(id).get()).data();
const rawAll = async (collection) =>
  (await FirestoreConnection.getConnection().collection(collection).get()).docs.map((doc) => doc.data());

const JOB_KEYS = new Set([
  'blacklist',
  'commuteFilter',
  'dealType',
  'enabled',
  'lastRunAt',
  'name',
  'notificationAdapter',
  'provider',
  'sharedWithUser',
  'spatialFilter',
  'specFilter',
  'userId',
]);
const USER_KEYS = new Set(['username', 'isAdmin', 'lastLogin']);
const SETTING_KEYS = new Set(['id', 'name', 'value', 'userId', 'createdAt']);
const LISTING_KEYS = new Set([
  'activeCheckFailures',
  'address',
  'buildYear',
  'connectivity',
  'connectivityCheckedAt',
  'connectivityFiber',
  'connectivityMaxDown',
  'connectivityMobileBits',
  'createdAt',
  'description',
  'distances',
  'energyClass',
  'hash',
  'imageUrl',
  'inactiveSince',
  'inquiryMessage',
  'inquiryRequestId',
  'inquirySendError',
  'inquirySendStartedAt',
  'inquirySendStatus',
  'inquirySentAt',
  'isActive',
  'jobId',
  'lastCheckedAt',
  'lastPriceCheckAt',
  'latitude',
  'lifecycle',
  'link',
  'longitude',
  'manuallyDeleted',
  'notes',
  'notificationComplete',
  'notifiedAt',
  'previousPrice',
  'price',
  'provider',
  'rooms',
  'size',
  'title',
  'travelTimeFailures',
  'travelTimesAt',
]);

const unknownKeys = (doc, allowed) => Object.keys(doc ?? {}).filter((key) => !allowed.has(key));

beforeAll(async () => {
  await initBackend();
  jobStorage = await loadStorageModule('jobStorage');
  userStorage = await loadStorageModule('userStorage');
  listingsStorage = await loadStorageModule('listingsStorage');
  settingsStorage = await loadStorageModule('settingsStorage');
});

beforeEach(async () => {
  await resetBackend();
  await userStorage.upsertUser({ userId: 'u1', username: 'guard@example.com', password: 'x', isAdmin: false });
});

afterAll(async () => {
  await teardownBackend();
});

describe('Firestore schema guard', () => {
  it('stores users without credentials', async () => {
    const doc = await raw('users', 'u1');
    expect(unknownKeys(doc, USER_KEYS)).toEqual([]);
  });

  it('stores jobs without the retired job-level autoSendInquiry', async () => {
    await jobStorage.upsertJob({
      jobId: 'j1',
      userId: 'u1',
      name: 'Guard',
      provider: [{ id: 'immoscout', url: 'https://www.immobilienscout24.de/Suche/de/berlin/wohnung-mieten' }],
      notificationAdapter: [],
      enabled: true,
      autoSendInquiry: true,
    });
    const doc = await raw('jobs', 'j1');
    expect(unknownKeys(doc, JOB_KEYS)).toEqual([]);
    expect(doc).not.toHaveProperty('autoSendInquiry');
  });

  it('stores listings in the full canonical shape and nothing else', async () => {
    await jobStorage.upsertJob({ jobId: 'j1', userId: 'u1', name: 'Guard', provider: [], notificationAdapter: [] });
    await listingsStorage.storeListings('j1', 'immoscout', [
      { id: 'h1', title: 'Flat', price: 1000, size: 50, rooms: 2, address: 'Street 1, Berlin', link: 'https://x' },
    ]);
    const [doc] = await rawAll('listings');
    expect(unknownKeys(doc, LISTING_KEYS)).toEqual([]);
    // Every optional field is present (explicit null), so equality queries can find it.
    expect(Object.keys(doc).sort()).toEqual([...LISTING_KEYS].sort());
    expect(doc).not.toHaveProperty('status');
  });

  it('stores settings with createdAt', async () => {
    await settingsStorage.upsertSettings({ theme: 'dark' }, 'u1');
    const [doc] = await rawAll('settings');
    expect(unknownKeys(doc, SETTING_KEYS)).toEqual([]);
  });
});
