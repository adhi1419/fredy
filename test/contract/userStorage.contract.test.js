/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: userStorage
 *
 * Backend-agnostic behavioral contract for the user module. Seeds and asserts
 * ONLY through the public storage API (userStorage, jobStorage, settingsStorage).
 * Must pass unchanged against every storage backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let userStorage;
let jobStorage;
let settingsStorage;
let hashModule;

beforeAll(async () => {
  await initBackend();
  userStorage = await import('../../lib/services/storage/userStorage.js');
  jobStorage = await import('../../lib/services/storage/jobStorage.js');
  settingsStorage = await import('../../lib/services/storage/settingsStorage.js');
  hashModule = await import('../../lib/services/security/hash.js');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a user and return the id we can look it up with. */
async function seedUser({ username = 'alice', password = 'secret', isAdmin = false } = {}) {
  await userStorage.upsertUser({ username, password, isAdmin });
  const users = userStorage.getUsers();
  const u = users.find((r) => r.username === username);
  return u.id;
}

/** Seed a minimal job owned by userId. */
function seedJob(userId, name = 'job-1') {
  jobStorage.upsertJob({
    name,
    provider: [],
    notificationAdapter: [],
    userId,
  });
}

// ---------------------------------------------------------------------------
// upsertUser
// ---------------------------------------------------------------------------

describe('userStorage contract', () => {
  describe('upsertUser', () => {
    it('inserts a new user retrievable by getUsers', async () => {
      await userStorage.upsertUser({ username: 'alice', password: 'pw', isAdmin: false });
      const users = userStorage.getUsers();
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('alice');
      expect(users[0].isAdmin).toBe(false);
    });

    it('inserts a new admin user', async () => {
      await userStorage.upsertUser({ username: 'boss', password: 'pw', isAdmin: true });
      const users = userStorage.getUsers();
      expect(users[0].isAdmin).toBe(true);
    });

    it('updates username and isAdmin when userId is provided', async () => {
      const id = await seedUser({ username: 'alice', isAdmin: false });
      await userStorage.upsertUser({ userId: id, username: 'alice-renamed', password: '', isAdmin: true });
      const user = userStorage.getUser(id);
      expect(user.username).toBe('alice-renamed');
      expect(user.isAdmin).toBe(true);
    });

    it('preserves existing password hash when update password is empty', async () => {
      const id = await seedUser({ username: 'alice', password: 'original' });
      const before = userStorage.getUserWithSecretsByUsername('alice');
      await userStorage.upsertUser({ userId: id, username: 'alice', password: '', isAdmin: false });
      const after = userStorage.getUserWithSecretsByUsername('alice');
      expect(after.password).toBe(before.password);
    });

    it('updates password hash when a non-empty password is provided', async () => {
      const id = await seedUser({ username: 'alice', password: 'original' });
      const before = userStorage.getUserWithSecretsByUsername('alice');
      await userStorage.upsertUser({ userId: id, username: 'alice', password: 'changed', isAdmin: false });
      const after = userStorage.getUserWithSecretsByUsername('alice');
      expect(after.password).not.toBe(before.password);
    });

    it('generates an MCP token on insert', async () => {
      const id = await seedUser();
      const token = userStorage.getMcpToken(id);
      expect(token).toBeTruthy();
      expect(token.startsWith('fredy_')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getUsers
  // ---------------------------------------------------------------------------

  describe('getUsers', () => {
    it('returns empty array when no users exist', () => {
      expect(userStorage.getUsers()).toEqual([]);
    });

    it('returns users ordered by username', async () => {
      await seedUser({ username: 'zara' });
      await seedUser({ username: 'alice' });
      const names = userStorage.getUsers().map((u) => u.username);
      expect(names).toEqual(['alice', 'zara']);
    });

    it('includes numberOfJobs count per user', async () => {
      const id = await seedUser({ username: 'alice' });
      seedJob(id, 'j1');
      seedJob(id, 'j2');
      const user = userStorage.getUsers().find((u) => u.id === id);
      expect(user.numberOfJobs).toBe(2);
    });

    it('does not expose password or mcp_token', async () => {
      await seedUser();
      const user = userStorage.getUsers()[0];
      expect(user.password).toBeUndefined();
      expect(user.mcp_token).toBeUndefined();
      expect(user.mcpToken).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getUser
  // ---------------------------------------------------------------------------

  describe('getUser', () => {
    it('returns null for non-existent id', () => {
      expect(userStorage.getUser('does-not-exist')).toBeNull();
    });

    it('returns user with correct shape', async () => {
      const id = await seedUser({ username: 'alice', isAdmin: true });
      const user = userStorage.getUser(id);
      expect(user).toMatchObject({
        id,
        username: 'alice',
        isAdmin: true,
      });
      expect(user.numberOfJobs).toBe(0);
      expect(user.password).toBeUndefined();
      expect(user.mcp_token).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getUserByUsername
  // ---------------------------------------------------------------------------

  describe('getUserByUsername', () => {
    it('returns null for non-existent username', () => {
      expect(userStorage.getUserByUsername('ghost')).toBeNull();
    });

    it('returns user without secrets', async () => {
      await seedUser({ username: 'alice', isAdmin: false });
      const user = userStorage.getUserByUsername('alice');
      expect(user.username).toBe('alice');
      expect(user.isAdmin).toBe(false);
      expect(user.id).toBeTruthy();
      // Secrets MUST be stripped
      expect(user.password).toBeUndefined();
      expect(user.mcp_token).toBeUndefined();
      expect(user.mcpToken).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getUserWithSecretsByUsername
  // ---------------------------------------------------------------------------

  describe('getUserWithSecretsByUsername', () => {
    it('returns null for non-existent username', () => {
      expect(userStorage.getUserWithSecretsByUsername('ghost')).toBeNull();
    });

    it('includes password hash', async () => {
      await seedUser({ username: 'alice', password: 'secret' });
      const user = userStorage.getUserWithSecretsByUsername('alice');
      expect(user.password).toBeTruthy();
      expect(typeof user.password).toBe('string');
      // Hash should be verifiable
      expect(await hashModule.verify('secret', user.password)).toBe(true);
    });

    it('includes isAdmin as a truthy/falsy value', async () => {
      await seedUser({ username: 'alice', isAdmin: true });
      const user = userStorage.getUserWithSecretsByUsername('alice');
      expect(user.isAdmin).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // setLastLoginToNow
  // ---------------------------------------------------------------------------

  describe('setLastLoginToNow', () => {
    it('sets lastLogin to a recent timestamp', async () => {
      const id = await seedUser({ username: 'alice' });
      const before = Date.now();
      userStorage.setLastLoginToNow({ userId: id });
      const after = Date.now();
      const user = userStorage.getUser(id);
      expect(user.lastLogin).toBeGreaterThanOrEqual(before);
      expect(user.lastLogin).toBeLessThanOrEqual(after);
    });

    it('lastLogin is null before first login', async () => {
      const id = await seedUser({ username: 'alice' });
      const user = userStorage.getUser(id);
      expect(user.lastLogin).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // updatePasswordHash
  // ---------------------------------------------------------------------------

  describe('updatePasswordHash', () => {
    it('replaces the stored hash directly', async () => {
      const id = await seedUser({ username: 'alice', password: 'old' });
      const newHash = await hashModule.hash('new-password');
      userStorage.updatePasswordHash({ userId: id, passwordHash: newHash });
      const user = userStorage.getUserWithSecretsByUsername('alice');
      expect(user.password).toBe(newHash);
      expect(await hashModule.verify('new-password', user.password)).toBe(true);
      expect(await hashModule.verify('old', user.password)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // removeUser (cascade)
  // ---------------------------------------------------------------------------

  describe('removeUser', () => {
    it('deletes the user', async () => {
      const id = await seedUser({ username: 'alice' });
      userStorage.removeUser(id);
      expect(userStorage.getUser(id)).toBeNull();
    });

    it('cascades: user jobs disappear', async () => {
      const id = await seedUser({ username: 'alice' });
      seedJob(id, 'doomed-job');
      // Pre-condition: the job exists
      const jobsBefore = jobStorage.getJobs({ includeDisabled: true });
      expect(jobsBefore.some((j) => j.name === 'doomed-job')).toBe(true);

      userStorage.removeUser(id);

      // Post-condition: the job is gone
      const jobsAfter = jobStorage.getJobs({ includeDisabled: true });
      expect(jobsAfter.some((j) => j.name === 'doomed-job')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // MCP token management
  // ---------------------------------------------------------------------------

  describe('validateMcpToken', () => {
    it('returns userId for a valid token', async () => {
      const id = await seedUser({ username: 'alice' });
      const token = userStorage.getMcpToken(id);
      const result = userStorage.validateMcpToken(token);
      expect(result).toEqual({ userId: id });
    });

    it('returns null for an invalid token', () => {
      expect(userStorage.validateMcpToken('fredy_bogus')).toBeNull();
    });

    it('returns null for null/undefined/empty', () => {
      expect(userStorage.validateMcpToken(null)).toBeNull();
      expect(userStorage.validateMcpToken(undefined)).toBeNull();
      expect(userStorage.validateMcpToken('')).toBeNull();
    });
  });

  describe('getMcpToken', () => {
    it('returns a fredy_ prefixed token for an existing user', async () => {
      const id = await seedUser({ username: 'alice' });
      const token = userStorage.getMcpToken(id);
      expect(typeof token).toBe('string');
      expect(token.startsWith('fredy_')).toBe(true);
      expect(token.length).toBeGreaterThan(10);
    });

    it('returns null for a non-existent user', () => {
      expect(userStorage.getMcpToken('no-such-id')).toBeNull();
    });

    it('each user gets a unique token', async () => {
      const id1 = await seedUser({ username: 'alice' });
      const id2 = await seedUser({ username: 'bob' });
      expect(userStorage.getMcpToken(id1)).not.toBe(userStorage.getMcpToken(id2));
    });
  });

  // ---------------------------------------------------------------------------
  // ensureAdminUserExists
  // ---------------------------------------------------------------------------

  describe('ensureAdminUserExists', () => {
    it('creates an admin user on empty DB', async () => {
      await userStorage.ensureAdminUserExists();
      const users = userStorage.getUsers();
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('admin');
      expect(users[0].isAdmin).toBe(true);
    });

    it('admin is created with the default password', async () => {
      await userStorage.ensureAdminUserExists();
      const admin = userStorage.getUserWithSecretsByUsername('admin');
      expect(await hashModule.verify(userStorage.DEFAULT_ADMIN_PASSWORD, admin.password)).toBe(true);
    });

    it('admin is created with a last_login timestamp', async () => {
      const before = Date.now();
      await userStorage.ensureAdminUserExists();
      const admin = userStorage.getUsers()[0];
      expect(admin.lastLogin).toBeGreaterThanOrEqual(before);
    });

    it('promotes first user when no admin exists', async () => {
      // Create two non-admin users
      await seedUser({ username: 'beta' });
      await seedUser({ username: 'alpha' });

      await userStorage.ensureAdminUserExists();

      const users = userStorage.getUsers();
      const admins = users.filter((u) => u.isAdmin);
      // Exactly one user promoted
      expect(admins).toHaveLength(1);
    });

    it('does nothing when an admin already exists', async () => {
      await seedUser({ username: 'boss', isAdmin: true });
      await seedUser({ username: 'pleb', isAdmin: false });

      await userStorage.ensureAdminUserExists();

      const users = userStorage.getUsers();
      expect(users).toHaveLength(2);
      const admins = users.filter((u) => u.isAdmin);
      expect(admins).toHaveLength(1);
      expect(admins[0].username).toBe('boss');
    });
  });

  // ---------------------------------------------------------------------------
  // ensureDemoUserExists
  // ---------------------------------------------------------------------------

  describe('ensureDemoUserExists', () => {
    it('creates a non-admin demo user when demoMode is on', async () => {
      settingsStorage.upsertSettings({ demoMode: true });

      await userStorage.ensureDemoUserExists();

      const demo = userStorage.getUserByUsername('demo');
      expect(demo).not.toBeNull();
      expect(demo.isAdmin).toBe(false);
    });

    it('demo user password is verifiable as "demo"', async () => {
      settingsStorage.upsertSettings({ demoMode: true });
      await userStorage.ensureDemoUserExists();

      const demo = userStorage.getUserWithSecretsByUsername('demo');
      expect(await hashModule.verify('demo', demo.password)).toBe(true);
    });

    it('demotes an existing admin demo user', async () => {
      // Seed a demo user with admin rights
      await userStorage.upsertUser({ username: 'demo', password: 'demo', isAdmin: true });
      settingsStorage.upsertSettings({ demoMode: true });

      await userStorage.ensureDemoUserExists();

      const demo = userStorage.getUserByUsername('demo');
      expect(demo.isAdmin).toBe(false);
    });

    it('does not create a demo user when demoMode is off (dev mode)', async () => {
      // demoMode defaults to falsy from config. In dev mode (NODE_ENV != production),
      // the function returns early without deleting an existing demo user.
      settingsStorage.upsertSettings({ demoMode: false });
      await userStorage.ensureDemoUserExists();

      expect(userStorage.getUserByUsername('demo')).toBeNull();
    });
  });
});
