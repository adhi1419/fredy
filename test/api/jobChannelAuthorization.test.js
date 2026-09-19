/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { createFirestoreMemory } from '../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({ demoMode: false }),
  upsertSettings: () => {},
}));

const ALICE = { id: 'u1', username: 'alice', isAdmin: false };
const BOB = { id: 'u2', username: 'bob', isAdmin: false };
const ADMIN = { id: 'a1', username: 'root', isAdmin: true };

describe('POST /api/jobs channel authorisation', () => {
  let app;
  let storage;
  let currentUser;

  const build = async () => {
    const plugin = (await import('../../lib/api/routes/jobRouter.js')).default;
    const instance = Fastify();
    instance.addHook('preHandler', async (request) => {
      request.currentUser = currentUser;
      request.session = { currentUser: currentUser.id };
    });
    await instance.register(plugin, { prefix: '/api/jobs' });
    return instance;
  };

  beforeEach(async () => {
    firestore.clear();
    currentUser = ALICE;
    storage = await import('../../lib/services/storage/configuredAdapterStorage.js');
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  const seedChannel = (over = {}) =>
    storage.upsertChannel({
      userId: 'u1',
      adapterId: 'telegram',
      name: 'Family',
      fields: { token: 'tok' },
      visibility: 'private',
      ...over,
    });

  const jobPayload = (over = {}) => ({
    name: 'My job',
    provider: [],
    blacklist: [],
    shareWithUsers: [],
    spatialFilter: null,
    specFilter: null,
    dealType: 'rent',
    notificationAdapter: [],
    ...over,
  });

  const post = (payload) => app.inject({ method: 'POST', url: '/api/jobs', payload });
  const storedJobs = () => firestore.list('jobs');
  const jobCount = () => storedJobs().length;
  const soleJobRow = () => storedJobs()[0];

  it('lets the owner of a private channel save a job referencing it, storing exactly the reference shape', async () => {
    const channelId = await seedChannel();

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(200);
    expect(soleJobRow().notificationAdapter).toEqual([{ configuredAdapterId: channelId }]);
  });

  it('lets a non-admin owner use their own private channel', async () => {
    const channelId = await seedChannel({ userId: 'u1' });

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(200);
  });

  it('rejects a stranger referencing a private channel, and does not write the job', async () => {
    const channelId = await seedChannel({ userId: 'u1', visibility: 'private' });
    currentUser = BOB;

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(403);
    expect(jobCount()).toBe(0);
  });

  it('rejects a stranger referencing an admin-visibility channel', async () => {
    const channelId = await seedChannel({ userId: 'u1', visibility: 'admin' });
    currentUser = BOB;

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(403);
    expect(jobCount()).toBe(0);
  });

  it('lets a stranger reference an everyone-visibility channel', async () => {
    const channelId = await seedChannel({ userId: 'u1', visibility: 'everyone' });
    currentUser = BOB;

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(200);
    expect(soleJobRow().notificationAdapter).toEqual([{ configuredAdapterId: channelId }]);
  });

  it('lets an admin reference anybody else’s private channel', async () => {
    const channelId = await seedChannel({ userId: 'u2', visibility: 'private' });
    currentUser = ADMIN;

    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(200);
    expect(soleJobRow().notificationAdapter).toEqual([{ configuredAdapterId: channelId }]);
  });

  it('rejects an unknown channel id with 400, and does not write the job', async () => {
    const response = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: 'does-not-exist' }] }));

    expect(response.statusCode).toBe(400);
    expect(jobCount()).toBe(0);
  });

  it('rejects a [valid, unusable] list with 403 without writing the job', async () => {
    const validId = await seedChannel({ userId: 'u1', visibility: 'private' });
    const unusableId = await seedChannel({ userId: 'u2', visibility: 'private' });
    currentUser = ALICE;

    const response = await post(
      jobPayload({
        notificationAdapter: [{ configuredAdapterId: validId }, { configuredAdapterId: unusableId }],
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(jobCount()).toBe(0);
  });

  it('rejects a [valid, unknown] list with 400 without writing the job', async () => {
    const validId = await seedChannel({ userId: 'u1', visibility: 'private' });

    const response = await post(
      jobPayload({
        notificationAdapter: [{ configuredAdapterId: validId }, { configuredAdapterId: 'does-not-exist' }],
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(jobCount()).toBe(0);
  });

  it('collapses duplicate ids across both accepted shapes into a single stored reference', async () => {
    const channelId = await seedChannel();

    const response = await post(jobPayload({ notificationAdapter: [channelId, { configuredAdapterId: channelId }] }));

    expect(response.statusCode).toBe(200);
    expect(soleJobRow().notificationAdapter).toEqual([{ configuredAdapterId: channelId }]);
  });

  it('stores an empty reference list for the legacy inline shape, rather than creating a channel', async () => {
    const response = await post(jobPayload({ notificationAdapter: [{ id: 'telegram', fields: { token: 'tok' } }] }));

    expect(response.statusCode).toBe(200);
    expect(soleJobRow().notificationAdapter).toEqual([]);
    expect(await storage.getAllChannels()).toHaveLength(0);
  });

  it('re-validates on update after a channel becomes private', async () => {
    const channelId = await seedChannel({ userId: 'u2', visibility: 'everyone' });
    const createResponse = await post(jobPayload({ notificationAdapter: [{ configuredAdapterId: channelId }] }));
    expect(createResponse.statusCode).toBe(200);
    const jobId = soleJobRow().id;

    await storage.upsertChannel({
      id: channelId,
      userId: 'u2',
      adapterId: 'telegram',
      name: 'Family',
      visibility: 'private',
    });

    const updateResponse = await post(
      jobPayload({ jobId, name: 'Renamed', notificationAdapter: [{ configuredAdapterId: channelId }] }),
    );

    expect(updateResponse.statusCode).toBe(403);
    expect(soleJobRow().name).not.toBe('Renamed');
  });
});
