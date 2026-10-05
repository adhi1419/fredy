/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createFirestoreMemory } from '../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const ADDRESSES = [{ id: 'addr-work', label: 'Work', address: 'Office', coords: { lat: 1, lng: 2 } }];
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({}),
  getUserSettings: async () => ({ home_addresses: ADDRESSES }),
  getAddresses: (settings) => settings?.home_addresses ?? [],
  upsertSettings: () => {},
}));

const buildApp = async () => {
  const plugin = (await import('../../lib/api/routes/jobRouter.js')).default;
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.currentUser = { id: 'u1', username: 'alice', isAdmin: false };
  });
  await app.register(plugin, { prefix: '/api/jobs' });
  return app;
};

/**
 * A commute limit names a saved address by id. One naming anything else can never be evaluated:
 * notifications would ignore it and automatic applications would refuse every listing.
 */
describe('job commute filter API', () => {
  let app;

  beforeEach(async () => {
    firestore.clear();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (commuteFilter) =>
    app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { name: 'Commute', provider: [], notificationAdapter: [], commuteFilter },
    });

  it('stores limits keyed by the owner’s address ids', async () => {
    const response = await post({ action: 'exclude', limits: { 'addr-work': 25 } });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].commuteFilter).toEqual({ action: 'exclude', limits: { 'addr-work': 25 } });
  });

  it('refuses a limit keyed by a label or an unknown id', async () => {
    for (const key of ['Work', 'addr-somebody-else']) {
      const response = await post({ action: 'exclude', limits: { [key]: 25 } });
      expect(response.statusCode).toBe(400);
    }
    expect(firestore.list('jobs')).toHaveLength(0);
  });
});
