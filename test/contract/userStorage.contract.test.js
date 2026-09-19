/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initBackend, loadStorageModule, resetBackend, teardownBackend } from './harness.js';

let userStorage;
let jobStorage;
let settingsStorage;

beforeAll(async () => {
  await initBackend();
  userStorage = await loadStorageModule('userStorage');
  jobStorage = await loadStorageModule('jobStorage');
  settingsStorage = await loadStorageModule('settingsStorage');
});

beforeEach(async () => resetBackend());
afterAll(async () => teardownBackend());

async function seedUser({ id = 'uid-alice', username = 'alice@example.com', isAdmin = false } = {}) {
  await userStorage.upsertUser({ userId: id, username, isAdmin });
  return id;
}

async function seedJob(userId, name = 'job-1') {
  await jobStorage.upsertJob({ name, provider: [], notificationAdapter: [], userId });
}

describe('userStorage contract', () => {
  it('provisions a Firebase UID without credentials', async () => {
    await seedUser();
    const user = await userStorage.getUser('uid-alice');
    expect(user).toMatchObject({ id: 'uid-alice', username: 'alice@example.com', isAdmin: false });
    expect(user).not.toHaveProperty('password');
  });

  it('updates the email and allowlist-derived admin projection', async () => {
    await seedUser();
    await userStorage.upsertUser({ userId: 'uid-alice', username: 'new@example.com', isAdmin: true });
    expect(await userStorage.getUserIdentity('uid-alice')).toMatchObject({
      id: 'uid-alice',
      username: 'new@example.com',
      isAdmin: true,
    });
  });

  it('returns null for missing or invalid ids', async () => {
    expect(await userStorage.getUserIdentity('missing')).toBeNull();
    expect(await userStorage.getUserIdentity(null)).toBeNull();
    expect(await userStorage.getUser(null)).toBeNull();
  });

  it('orders users by email and includes job counts only in list/detail reads', async () => {
    await seedUser({ id: 'uid-z', username: 'z@example.com' });
    await seedUser({ id: 'uid-a', username: 'a@example.com' });
    await seedJob('uid-a', 'one');
    await seedJob('uid-a', 'two');
    const users = await userStorage.getUsers();
    expect(users.map((user) => user.username)).toEqual(['a@example.com', 'z@example.com']);
    expect(users[0].numberOfJobs).toBe(2);
    expect(await userStorage.getUserIdentity('uid-a')).not.toHaveProperty('numberOfJobs');
  });

  it('looks up a provisioned user by normalized stored email', async () => {
    await seedUser();
    expect(await userStorage.getUserByUsername('alice@example.com')).toMatchObject({ id: 'uid-alice' });
    expect(await userStorage.getUserByUsername('missing@example.com')).toBeNull();
  });

  it('records the last successful app bootstrap', async () => {
    await seedUser();
    const before = Date.now();
    await userStorage.setLastLoginToNow({ userId: 'uid-alice' });
    expect((await userStorage.getUser('uid-alice')).lastLogin).toBeGreaterThanOrEqual(before);
  });

  it('removes a user and cascades their jobs', async () => {
    await seedUser();
    await seedJob('uid-alice', 'doomed');
    await userStorage.removeUser('uid-alice');
    expect(await userStorage.getUser('uid-alice')).toBeNull();
    expect((await jobStorage.getJobs({ includeDisabled: true })).some((job) => job.name === 'doomed')).toBe(false);
  });

  it('maintains a non-admin demo data owner only when demo mode is enabled', async () => {
    await settingsStorage.upsertSettings({ demoMode: true });
    await userStorage.ensureDemoUserExists();
    expect(await userStorage.getUserByUsername('demo')).toMatchObject({ isAdmin: false });
  });

  it('demotes an existing demo owner', async () => {
    await seedUser({ id: 'demo-id', username: 'demo', isAdmin: true });
    await settingsStorage.upsertSettings({ demoMode: true });
    await userStorage.ensureDemoUserExists();
    expect(await userStorage.getUserIdentity('demo-id')).toMatchObject({ isAdmin: false });
  });
});
