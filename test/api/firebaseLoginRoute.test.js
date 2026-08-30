/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * POST /api/login/firebase — the multi-tenant login exchange.
 *
 * The contract (doc/prd-multi-tenant-auth.md):
 *  - password mode: route answers 404, nothing runs
 *  - invalid/expired token: 401, no user provisioned, no session
 *  - valid token, email not allowlisted: 403, no user provisioned, no session
 *  - valid token + allowlisted: user provisioned with UID as id + isAdmin
 *    from the allowlist, lastLogin touched, session established
 *  - second login: upsert again (no duplicate — upsert semantics are
 *    contract-tested), isAdmin re-synced from the allowlist
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

let authModeValue = 'firebase';
let verifyImpl;
let allowlist;
const upsertCalls = [];
const lastLoginCalls = [];

vi.mock('../../lib/services/authMode.js', () => ({
  isFirebaseAuth: () => authModeValue === 'firebase',
  AUTH_MODE: 'mocked',
}));
vi.mock('../../lib/services/firebaseAdmin.js', () => ({
  verifyIdToken: (token) => verifyImpl(token),
}));
vi.mock('../../lib/services/storage/firestore/allowedUsersStorage.js', () => ({
  getAllowedUser: async (email) => allowlist.get(email) ?? null,
}));
vi.mock('../../lib/services/storage/userStorage.js', () => ({
  upsertUser: async (params) => {
    upsertCalls.push(params);
  },
  setLastLoginToNow: async (params) => {
    lastLoginCalls.push(params);
  },
}));

describe('POST /api/login/firebase', () => {
  let app;
  let capturedSession;

  const build = async () => {
    const plugin = (await import('../../lib/api/routes/firebaseLoginRoute.js')).default;
    const instance = Fastify();
    capturedSession = {};
    instance.addHook('onRequest', async (request) => {
      request.session = capturedSession;
    });
    await instance.register(plugin, { prefix: '/api/login/firebase' });
    return instance;
  };

  const exchange = (idToken) =>
    app.inject({
      method: 'POST',
      url: '/api/login/firebase',
      // Vary the source address per test so the module-scoped rate limiter
      // (15-minute window) never trips across the suite.
      remoteAddress: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: idToken === undefined ? {} : { idToken },
    });

  beforeEach(async () => {
    authModeValue = 'firebase';
    verifyImpl = async () => {
      throw new Error('verify not stubbed');
    };
    allowlist = new Map();
    upsertCalls.length = 0;
    lastLoginCalls.length = 0;
    vi.resetModules();
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 404 in password mode and never verifies anything', async () => {
    authModeValue = 'password';
    const verifySpy = vi.fn();
    verifyImpl = verifySpy;
    const res = await exchange('whatever');
    expect(res.statusCode).toBe(404);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(upsertCalls).toHaveLength(0);
  });

  it('answers 400 for a missing idToken', async () => {
    const res = await exchange(undefined);
    expect(res.statusCode).toBe(400);
    expect(upsertCalls).toHaveLength(0);
  });

  it('answers 401 for an invalid or expired token, provisioning nothing', async () => {
    verifyImpl = async () => {
      const err = new Error('auth/id-token-expired');
      err.code = 'auth/id-token-expired';
      throw err;
    };
    const res = await exchange('expired-token');
    expect(res.statusCode).toBe(401);
    expect(upsertCalls).toHaveLength(0);
    expect(capturedSession.currentUser).toBeUndefined();
  });

  it('answers 403 for a valid token whose email is not allowlisted', async () => {
    verifyImpl = async () => ({ uid: 'uid-eve', email: 'eve@example.com' });
    const res = await exchange('valid-token');
    expect(res.statusCode).toBe(403);
    expect(upsertCalls).toHaveLength(0);
    expect(capturedSession.currentUser).toBeUndefined();
  });

  it('provisions the user with UID as id and establishes a session when allowlisted', async () => {
    verifyImpl = async () => ({ uid: 'uid-alice', email: 'alice@example.com' });
    allowlist.set('alice@example.com', { email: 'alice@example.com', isAdmin: false });

    const res = await exchange('valid-token');

    expect(res.statusCode).toBe(200);
    expect(upsertCalls).toEqual([{ userId: 'uid-alice', username: 'alice@example.com', isAdmin: false }]);
    expect(lastLoginCalls).toEqual([{ userId: 'uid-alice' }]);
    expect(capturedSession.currentUser).toBe('uid-alice');
    expect(capturedSession.createdAt).toBeGreaterThan(0);
    expect(res.json()).toEqual({ userId: 'uid-alice', isAdmin: false });
  });

  it('normalizes the email case before the allowlist lookup', async () => {
    verifyImpl = async () => ({ uid: 'uid-bob', email: 'Bob@Example.COM' });
    allowlist.set('bob@example.com', { email: 'bob@example.com', isAdmin: false });
    const res = await exchange('valid-token');
    expect(res.statusCode).toBe(200);
    expect(upsertCalls[0].username).toBe('bob@example.com');
  });

  it('answers 401 for a token that carries no email', async () => {
    verifyImpl = async () => ({ uid: 'uid-anon' });
    const res = await exchange('valid-token');
    expect(res.statusCode).toBe(401);
    expect(upsertCalls).toHaveLength(0);
  });

  it('re-syncs isAdmin from the allowlist on every login (second login, no duplicate logic here)', async () => {
    verifyImpl = async () => ({ uid: 'uid-alice', email: 'alice@example.com' });
    allowlist.set('alice@example.com', { email: 'alice@example.com', isAdmin: false });
    await exchange('valid-token');
    // Operator promotes alice in Firestore:
    allowlist.set('alice@example.com', { email: 'alice@example.com', isAdmin: true });
    const res = await exchange('valid-token');
    expect(res.statusCode).toBe(200);
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[1].isAdmin).toBe(true);
    expect(res.json().isAdmin).toBe(true);
  });

  describe('GET /config', () => {
    it('reports enabled with the parsed web config in firebase mode', async () => {
      process.env.FIREBASE_WEB_CONFIG = '{"apiKey":"k","projectId":"p"}';
      const res = await app.inject({ method: 'GET', url: '/api/login/firebase/config' });
      expect(res.json()).toEqual({ enabled: true, firebaseConfig: { apiKey: 'k', projectId: 'p' } });
      delete process.env.FIREBASE_WEB_CONFIG;
    });

    it('reports disabled with no config in password mode', async () => {
      authModeValue = 'password';
      const res = await app.inject({ method: 'GET', url: '/api/login/firebase/config' });
      expect(res.json()).toEqual({ enabled: false, firebaseConfig: null });
    });
  });
});
