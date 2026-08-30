/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: sessionStore
 *
 * Backend-agnostic behavioral contract for the session store module. Seeds and
 * asserts ONLY through the public storage API. Must pass unchanged against
 * every storage backend (sqlite today, firestore in Phase 2).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend } from './harness.js';

let SqliteSessionStore;
let sweepExpiredSessions;
let store;

/** Promise wrappers around the callback-style store interface. */
const set = (sid, session) =>
  new Promise((resolve, reject) => store.set(sid, session, (e) => (e ? reject(e) : resolve())));
const get = (sid) => new Promise((resolve, reject) => store.get(sid, (e, s) => (e ? reject(e) : resolve(s))));
const destroy = (sid) => new Promise((resolve, reject) => store.destroy(sid, (e) => (e ? reject(e) : resolve())));

const sessionFor = (userId, maxAge = 60_000) => ({
  currentUser: userId,
  createdAt: Date.now(),
  cookie: { originalMaxAge: maxAge, expires: new Date(Date.now() + maxAge) },
});

beforeAll(async () => {
  await initBackend();
  const mod = await import('../../lib/services/storage/sessionStore.js');
  SqliteSessionStore = mod.SqliteSessionStore;
  sweepExpiredSessions = mod.sweepExpiredSessions;
  store = new SqliteSessionStore();
});

beforeEach(async () => {
  await resetBackend();
  // Re-create a fresh store instance after data wipe so no stale state lingers.
  store = new SqliteSessionStore();
});

afterAll(async () => {
  await teardownBackend();
});

describe('sessionStore contract', () => {
  describe('set / get round-trip', () => {
    it('round-trips a session through set + get', async () => {
      await set('sid-1', sessionFor('user-1'));
      const loaded = await get('sid-1');
      expect(loaded).not.toBeNull();
      expect(loaded.currentUser).toBe('user-1');
    });

    it('preserves all session properties including nested cookie', async () => {
      const session = sessionFor('user-1', 120_000);
      session.extra = { nested: true };
      await set('sid-2', session);
      const loaded = await get('sid-2');
      expect(loaded.extra).toEqual({ nested: true });
      expect(loaded.cookie.originalMaxAge).toBe(120_000);
    });

    it('overwrites an existing session (upsert semantics)', async () => {
      await set('sid-1', sessionFor('user-1'));
      await set('sid-1', sessionFor('user-2'));
      const loaded = await get('sid-1');
      expect(loaded.currentUser).toBe('user-2');
    });
  });

  describe('get returns null for unknown sid', () => {
    it('returns null for a session that was never stored', async () => {
      expect(await get('never-existed')).toBeNull();
    });
  });

  describe('expired sessions', () => {
    it('treats an expired session as absent (returns null)', async () => {
      // Store a session that expires 1ms in the past.
      const session = {
        currentUser: 'user-1',
        cookie: { expires: new Date(Date.now() - 1000) },
      };
      await set('stale', session);
      expect(await get('stale')).toBeNull();
    });

    it('deletes an expired session row when get stumbles over it', async () => {
      const session = {
        currentUser: 'user-1',
        cookie: { expires: new Date(Date.now() - 1000) },
      };
      await set('stale', session);
      // First get returns null and deletes the row.
      await get('stale');
      // A second get should also be null (row is gone, not just filtered).
      expect(await get('stale')).toBeNull();
    });

    it('a non-expired session is returned normally', async () => {
      const session = sessionFor('user-1', 60_000);
      await set('fresh', session);
      const loaded = await get('fresh');
      expect(loaded).not.toBeNull();
      expect(loaded.currentUser).toBe('user-1');
    });
  });

  describe('destroy', () => {
    it('removes a session so get returns null', async () => {
      await set('sid-1', sessionFor('user-1'));
      await destroy('sid-1');
      expect(await get('sid-1')).toBeNull();
    });

    it('destroying a non-existent session does not error', async () => {
      await expect(destroy('ghost')).resolves.not.toThrow();
    });
  });

  describe('sweepExpiredSessions', () => {
    it('removes only expired sessions, keeping live ones', async () => {
      // Store one expired and one live session.
      await set('expired', { currentUser: 'old', cookie: { expires: new Date(Date.now() - 5000) } });
      await set('live', sessionFor('current', 600_000));

      const removed = sweepExpiredSessions(Date.now());
      expect(removed).toBe(1);

      // Live session survives.
      expect(await get('live')).not.toBeNull();
      // Expired one is gone.
      expect(await get('expired')).toBeNull();
    });

    it('returns 0 when there is nothing to sweep', () => {
      expect(sweepExpiredSessions(Date.now())).toBe(0);
    });

    it('respects the now parameter for sweep cutoff', async () => {
      const farFuture = Date.now() + 999_999_999;
      await set('will-expire', sessionFor('user-1', 60_000));

      // Sweeping at far future should remove it.
      const removed = sweepExpiredSessions(farFuture);
      expect(removed).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('falls back to a bounded lifetime when cookie has no expiry', async () => {
      await set('no-expiry', { currentUser: 'user-1' });
      // Should still be retrievable (default TTL is 30 days).
      const loaded = await get('no-expiry');
      expect(loaded).not.toBeNull();
      expect(loaded.currentUser).toBe('user-1');
    });

    it('survives a new store instance (persistence across restarts)', async () => {
      await set('sid-1', sessionFor('user-1'));
      const newStore = new SqliteSessionStore();
      const loaded = await new Promise((resolve, reject) =>
        newStore.get('sid-1', (e, s) => (e ? reject(e) : resolve(s))),
      );
      expect(loaded.currentUser).toBe('user-1');
    });
  });
});
