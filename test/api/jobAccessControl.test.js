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
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({ demoMode: false }),
}));

const ALICE = { id: 'u1', username: 'alice@example.com', isAdmin: false };
const BOB = { id: 'u2', username: 'bob@example.com', isAdmin: false };
const ADMIN = { id: 'admin', username: 'admin@example.com', isAdmin: true };

let app;
let currentUser;
let jobStorage;
let userStorage;

const buildApp = async () => {
  const plugin = (await import('../../lib/api/routes/jobRouter.js')).default;
  const instance = Fastify();
  instance.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await instance.register(plugin, { prefix: '/api/jobs' });
  return instance;
};

const seedJob = (user, overrides = {}) =>
  jobStorage.upsertJob({
    jobId: overrides.jobId ?? `${user.id}-job`,
    userId: user.id,
    name: overrides.name ?? `${user.username} search`,
    provider: [],
    notificationAdapter: [],
    shareWithUsers: overrides.shareWithUsers ?? [],
    enabled: true,
    dealType: 'rent',
  });

beforeEach(async () => {
  firestore.clear();
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
  userStorage = await import('../../lib/services/storage/userStorage.js');
  await userStorage.upsertUser({ userId: ALICE.id, username: ALICE.username, isAdmin: false });
  await userStorage.upsertUser({ userId: BOB.id, username: BOB.username, isAdmin: false });
  await userStorage.upsertUser({ userId: ADMIN.id, username: ADMIN.username, isAdmin: true });
  currentUser = ALICE;
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

describe('Saved Search product access routes', () => {
  it('does not let an admin browse another users private searches', async () => {
    await seedJob(BOB, { jobId: 'bob-private' });
    currentUser = ADMIN;

    const response = await app.inject({ method: 'GET', url: '/api/jobs/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('lets an admin read a search explicitly shared with them as read-only', async () => {
    await seedJob(BOB, { jobId: 'bob-shared', shareWithUsers: [ADMIN.id] });
    currentUser = ADMIN;

    const response = await app.inject({ method: 'GET', url: '/api/jobs/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({ id: 'bob-shared', isOnlyShared: true, shared_with_user: [ADMIN.id] }),
    ]);
  });

  it('keeps shared searches read-only for an admin', async () => {
    await seedJob(BOB, { jobId: 'bob-shared', shareWithUsers: [ADMIN.id] });
    currentUser = ADMIN;

    const run = await app.inject({ method: 'POST', url: '/api/jobs/bob-shared/run' });
    const status = await app.inject({ method: 'PUT', url: '/api/jobs/bob-shared/status', payload: { status: false } });
    const remove = await app.inject({ method: 'DELETE', url: '/api/jobs/', payload: { jobId: 'bob-shared' } });

    expect(run.statusCode).toBe(403);
    expect(status.statusCode).toBe(403);
    expect(remove.statusCode).toBe(403);
    expect(await jobStorage.getJob('bob-shared')).not.toBeNull();
  });

  it('lets an admin browse and run their own search', async () => {
    await seedJob(ADMIN, { jobId: 'admin-own' });
    currentUser = ADMIN;

    const list = await app.inject({ method: 'GET', url: '/api/jobs/' });
    const run = await app.inject({ method: 'POST', url: '/api/jobs/admin-own/run' });

    expect(list.json()).toEqual([expect.objectContaining({ id: 'admin-own', isOnlyShared: false })]);
    expect(run.statusCode).toBe(202);
  });

  it('lists every other user as shareable, including admins', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/jobs/shareableUserList' });

    expect(response.statusCode).toBe(200);
    expect(response.json().sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: ADMIN.id, name: ADMIN.username },
        { id: BOB.id, name: BOB.username },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});
