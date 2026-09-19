/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import wireContract from '../wireContracts.json';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAllowedUser: vi.fn(),
  getUserIdentity: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock('../../lib/services/firebaseAdmin.js', () => ({ verifyIdToken: mocks.verifyIdToken }));
vi.mock('../../lib/services/storage/firestore/allowedUsersStorage.js', () => ({
  getAllowedUser: mocks.getAllowedUser,
}));
vi.mock('../../lib/services/storage/userStorage.js', () => ({
  getUserIdentity: mocks.getUserIdentity,
  upsertUser: mocks.upsertUser,
}));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn() } }));

import authPlugin from '../../lib/api/routes/firebaseLoginRoute.js';
import jobPlugin from '../../lib/api/routes/jobRouter.js';
import { registerHttpSupport } from '../../lib/api/http.js';
import { heartbeat, sendToUser } from '../../lib/services/sse/sse-broker.js';

const FRONTEND_ORIGIN = wireContract.assumptions.frontendOrigin;

let app;

beforeEach(async () => {
  vi.stubEnv('FIREBASE_WEB_CONFIG', JSON.stringify(wireContract.http.authConfig.body.firebaseConfig));
  mocks.verifyIdToken.mockResolvedValue({ uid: 'uid-alice', email: 'alice@example.com', email_verified: true });
  mocks.getAllowedUser.mockResolvedValue({ email: 'alice@example.com', isAdmin: false });
  mocks.getUserIdentity.mockResolvedValue({ id: 'uid-alice', username: 'alice@example.com', isAdmin: false });
  app = Fastify();
  registerHttpSupport(app, { frontendOrigin: FRONTEND_ORIGIN });
  await app.register(authPlugin, { prefix: '/api/auth' });
  await app.register(async (secured) => {
    secured.addHook('preHandler', async (request) => {
      request.currentUser = { id: 'wire-test-user', isAdmin: false };
    });
    await secured.register(jobPlugin, { prefix: '/api/jobs' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function injectCase(testCase, options = {}) {
  return app.inject({ method: testCase.method, url: testCase.path, ...options });
}

function expectJson(response, expected) {
  expect(response.statusCode).toBe(expected.status);
  expect(response.headers['content-type']).toBe(expected.contentType ?? 'application/json; charset=utf-8');
  expect(response.json()).toEqual(expected.body);
}

describe('shared HTTP wire contract', () => {
  it('keeps health and API-only fallback externally observable cases stable', async () => {
    const health = await injectCase(wireContract.http.health);
    expectJson(health, wireContract.http.health);
    expect(health.headers.vary).toBe(wireContract.cors.vary);
    expect(health.headers['access-control-allow-origin']).toBeUndefined();

    const fallback = await injectCase(wireContract.http.apiOnlyFallback);
    expectJson(fallback, wireContract.http.apiOnlyFallback);
  });

  it('keeps public Firebase bootstrap separate from authorization', async () => {
    const response = await injectCase(wireContract.http.authConfig);
    expectJson(response, wireContract.http.authConfig);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('projects the Firebase-derived current user and preserves exact auth failures', async () => {
    const success = await injectCase(wireContract.http.authMe, {
      headers: { authorization: 'Bearer firebase-token' },
    });
    expectJson(success, { ...wireContract.http.authMe.success });

    const cases = wireContract.http.authMe.failures;
    const missingBearer = await injectCase(wireContract.http.authMe);
    expectJson(missingBearer, cases.missingBearer);

    mocks.verifyIdToken.mockRejectedValueOnce(new Error('expired'));
    const invalidToken = await injectCase(wireContract.http.authMe, {
      headers: { authorization: 'Bearer expired-token' },
    });
    expectJson(invalidToken, cases.invalidToken);

    mocks.verifyIdToken.mockResolvedValueOnce({ uid: 'uid-alice', email: 'alice@example.com' });
    const invalidClaims = await injectCase(wireContract.http.authMe, {
      headers: { authorization: 'Bearer malformed-token' },
    });
    expectJson(invalidClaims, cases.invalidClaims);

    mocks.getAllowedUser.mockResolvedValueOnce(null);
    const notAllowed = await injectCase(wireContract.http.authMe, {
      headers: { authorization: 'Bearer revoked-token' },
    });
    expectJson(notAllowed, cases.notAllowed);
  });

  it('keeps exact-origin bearer CORS and preflight headers stable', async () => {
    const cors = wireContract.cors;
    const bearer = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { origin: cors.allowOrigin, authorization: 'Bearer firebase-token' },
    });
    expect(bearer.headers['access-control-allow-origin']).toBe(cors.allowOrigin);
    expect(bearer.headers['access-control-allow-methods']).toBe(cors.allowMethods);
    expect(bearer.headers['access-control-allow-headers']).toBe(cors.allowHeaders);
    expect(bearer.headers['access-control-max-age']).toBe(cors.maxAge);
    expect(bearer.headers.vary).toBe(cors.vary);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: wireContract.http.authMe.path,
      headers: {
        origin: cors.allowOrigin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization, Content-Type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.body).toBe('');
    expect(preflight.headers['access-control-allow-origin']).toBe(cors.allowOrigin);
    expect(preflight.headers['access-control-allow-methods']).toBe(cors.allowMethods);
    expect(preflight.headers['access-control-allow-headers']).toBe(cors.allowHeaders);
    expect(preflight.headers['access-control-max-age']).toBe(cors.maxAge);
    expect(preflight.headers.vary).toBe(cors.vary);
  });

  it('keeps SSE handshake, event frames, heartbeat, and hijacked CORS stable', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/jobs/events`, {
      headers: { origin: FRONTEND_ORIGIN, authorization: 'Bearer firebase-token' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(wireContract.sse.contentType);
    expect(response.headers.get('access-control-allow-origin')).toBe(wireContract.cors.allowOrigin);
    expect(response.headers.get('access-control-allow-methods')).toBe(wireContract.cors.allowMethods);
    expect(response.headers.get('access-control-allow-headers')).toBe(wireContract.cors.allowHeaders);
    expect(response.headers.get('access-control-max-age')).toBe(wireContract.cors.maxAge);
    expect(response.headers.get('vary')).toBe(wireContract.cors.vary);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain(wireContract.sse.handshake);
    expect(first).toContain(wireContract.sse.hello);

    sendToUser('wire-test-user', 'jobStatus', { running: true });
    const event = decoder.decode((await reader.read()).value);
    expect(event).toBe(wireContract.sse.jobStatus);

    heartbeat();
    const heartbeatFrame = decoder.decode((await reader.read()).value);
    expect(heartbeatFrame).toMatch(new RegExp(wireContract.sse.heartbeatPattern));
    await reader.cancel();
  });
});
