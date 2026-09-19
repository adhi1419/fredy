/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: read-by-id with missing/empty ids.
 *
 * Firestore's .doc('') THROWS unless guarded. Saving a NEW job sends an empty
 * jobId and the route probes getJob(jobId) first, so every read-by-id operation
 * reachable with caller-supplied input must return null, not throw.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initBackend, teardownBackend, loadStorageModule } from './harness.js';

let jobStorage;
let userStorage;
let channelStorage;
let listingsStorage;

beforeAll(async () => {
  await initBackend();
  jobStorage = await loadStorageModule('jobStorage');
  userStorage = await loadStorageModule('userStorage');
  channelStorage = await loadStorageModule('configuredAdapterStorage');
  listingsStorage = await loadStorageModule('listingsStorage');
});

afterAll(async () => {
  await teardownBackend();
});

const EMPTYish = ['', null, undefined];

describe('Firestore read-by-id: empty ids mean "not found", never an error', () => {
  it('getJob', async () => {
    for (const id of EMPTYish) {
      expect(await jobStorage.getJob(id)).toBeNull();
    }
  });

  it('getUser', async () => {
    for (const id of EMPTYish) {
      expect(await userStorage.getUser(id)).toBeNull();
    }
  });

  it('getChannel', async () => {
    for (const id of EMPTYish) {
      expect(await channelStorage.getChannel(id)).toBeNull();
    }
  });

  it('getListingById', async () => {
    for (const id of EMPTYish) {
      expect(await listingsStorage.getListingById(id, 'any-user', true)).toBeNull();
    }
  });
});
