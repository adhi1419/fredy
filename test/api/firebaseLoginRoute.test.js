/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authHook: vi.fn(async (request) => {
    request.currentUser = { id: 'uid-from-firebase', username: 'alice@example.com', isAdmin: true };
  }),
}));

vi.mock('../../lib/api/security.js', () => ({ authHook: mocks.authHook }));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn() } }));

import authPlugin from '../../lib/api/routes/firebaseLoginRoute.js';

let app;

afterEach(async () => {
  delete process.env.FIREBASE_WEB_CONFIG;
  if (app) await app.close();
  app = undefined;
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
