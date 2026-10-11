/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authHook: vi.fn(async (request) => {
    request.currentUser = { id: 'uid-from-firebase', username: 'alice@example.com', isAdmin: true };
  }),
  verifiedIdentityHook: vi.fn(async (request) => {
    request.verifiedIdentity = { uid: 'uid-alice', email: 'alice@example.com', displayName: 'Alice' };
  }),
  getAllowedUser: vi.fn(),
  getAccessRequest: vi.fn(),
  createAccessRequest: vi.fn(),
}));

vi.mock('../../lib/api/security.js', () => ({
  authHook: mocks.authHook,
  verifiedIdentityHook: mocks.verifiedIdentityHook,
}));
vi.mock('../../lib/services/storage/firestore/allowedUsersStorage.js', () => ({
  getAllowedUser: mocks.getAllowedUser,
}));
vi.mock('../../lib/services/storage/firestore/accessRequestsStorage.js', () => ({
  getAccessRequest: mocks.getAccessRequest,
  createAccessRequest: mocks.createAccessRequest,
}));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn() } }));

import authPlugin from '../../lib/api/routes/firebaseLoginRoute.js';

let app;

beforeEach(() => {
  mocks.getAllowedUser.mockResolvedValue(null);
  mocks.getAccessRequest.mockResolvedValue(null);
  mocks.createAccessRequest.mockResolvedValue({
    email: 'alice@example.com',
    displayName: 'Alice',
    uid: 'uid-alice',
    requestedAt: 1,
    status: 'pending',
    decidedAt: null,
  });
});

afterEach(async () => {
  delete process.env.FIREBASE_WEB_CONFIG;
  if (app) await app.close();
  app = undefined;
  vi.clearAllMocks();
});

async function buildApp() {
  app = Fastify();
  await app.register(authPlugin, { prefix: '/api/auth' });
  return app;
}

describe('GET /api/auth/config', () => {
  it('is public and returns the parsed Firebase web configuration', async () => {
    process.env.FIREBASE_WEB_CONFIG = '{"apiKey":"public-key","projectId":"fredy"}';
    const instance = await buildApp();

    const response = await instance.inject({ method: 'GET', url: '/api/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      firebaseConfig: { apiKey: 'public-key', projectId: 'fredy' },
    });
    expect(mocks.authHook).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['invalid', 'not-json'],
  ])('returns a disabled bootstrap response when Firebase web config is %s', async (_name, value) => {
    if (value === undefined) delete process.env.FIREBASE_WEB_CONFIG;
    else process.env.FIREBASE_WEB_CONFIG = value;
    const instance = await buildApp();

    const response = await instance.inject({ method: 'GET', url: '/api/auth/config' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.body).toBe('{"enabled":false,"firebaseConfig":null}');
    expect(mocks.authHook).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/me', () => {
  it('is protected and returns the Firebase-derived request identity, not session identity', async () => {
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'uid-from-firebase', username: 'alice@example.com', isAdmin: true });
    expect(mocks.authHook).toHaveBeenCalledTimes(1);
  });

  it('does not expose a POST token-exchange route', async () => {
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'POST',
      url: '/api/auth',
      payload: { idToken: 'legacy-token' },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/auth/access-request', () => {
  it('returns approved when the caller is already allowlisted, without reading the waitlist', async () => {
    mocks.getAllowedUser.mockResolvedValue({ email: 'alice@example.com', isAdmin: false });
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'GET',
      url: '/api/auth/access-request',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'approved' });
    expect(mocks.getAccessRequest).not.toHaveBeenCalled();
  });

  it('returns the stored request status when not allowlisted', async () => {
    mocks.getAccessRequest.mockResolvedValue({ status: 'declined' });
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'GET',
      url: '/api/auth/access-request',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'declined' });
    expect(mocks.getAccessRequest).toHaveBeenCalledWith('alice@example.com');
  });

  it('returns none when neither allowlisted nor requested', async () => {
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'GET',
      url: '/api/auth/access-request',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'none' });
  });

  it('requires a verified identity, not a session', async () => {
    mocks.verifiedIdentityHook.mockImplementationOnce(async (_request, reply) =>
      reply.code(401).send({ reason: 'invalid authorization' }),
    );
    const instance = await buildApp();

    const response = await instance.inject({ method: 'GET', url: '/api/auth/access-request' });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/access-request', () => {
  it('returns approved and writes nothing when the caller is already allowlisted', async () => {
    mocks.getAllowedUser.mockResolvedValue({ email: 'alice@example.com', isAdmin: false });
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'POST',
      url: '/api/auth/access-request',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'approved' });
    expect(mocks.createAccessRequest).not.toHaveBeenCalled();
  });

  it('creates a waitlist entry and returns its status when not allowlisted', async () => {
    const instance = await buildApp();

    const response = await instance.inject({
      method: 'POST',
      url: '/api/auth/access-request',
      headers: { authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'pending' });
    expect(mocks.createAccessRequest).toHaveBeenCalledWith({
      email: 'alice@example.com',
      displayName: 'Alice',
      uid: 'uid-alice',
    });
  });

  it('never returns 403, even for an unverified caller - that is a 401 instead', async () => {
    mocks.verifiedIdentityHook.mockImplementationOnce(async (_request, reply) =>
      reply.code(401).send({ reason: 'invalid authorization' }),
    );
    const instance = await buildApp();

    const response = await instance.inject({ method: 'POST', url: '/api/auth/access-request' });

    expect(response.statusCode).toBe(401);
  });
});
