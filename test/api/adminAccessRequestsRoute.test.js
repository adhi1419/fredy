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

const ADMIN = { id: 'admin', username: 'admin@example.com', isAdmin: true };
const NON_ADMIN = { id: 'u1', username: 'alice@example.com', isAdmin: false };

let app;
let currentUser;
let accessRequestsStorage;
let allowedUsersStorage;

const buildApp = async () => {
  const plugin = (await import('../../lib/api/routes/adminAccessRequestsRoute.js')).default;
  const instance = Fastify();
  instance.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await instance.register(plugin, { prefix: '/api/admin/access-requests' });
  return instance;
};

beforeEach(async () => {
  firestore.clear();
  accessRequestsStorage = await import('../../lib/services/storage/firestore/accessRequestsStorage.js');
  allowedUsersStorage = await import('../../lib/services/storage/firestore/allowedUsersStorage.js');
  currentUser = ADMIN;
  app = await buildApp();
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('adminHook gating', () => {
  it('rejects a non-admin caller with 403 on every route', async () => {
    currentUser = NON_ADMIN;
    app = await buildApp();

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/admin/access-requests/' }),
      app.inject({ method: 'POST', url: '/api/admin/access-requests/someone@example.com/approve' }),
      app.inject({ method: 'POST', url: '/api/admin/access-requests/someone@example.com/decline' }),
      app.inject({ method: 'DELETE', url: '/api/admin/access-requests/someone@example.com' }),
    ]);

    for (const response of responses) expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/admin/access-requests/', () => {
  it('lists pending and declined requests, requestedAt ascending', async () => {
    await accessRequestsStorage.createAccessRequest({ email: 'first@example.com', uid: 'uid-1' });
    await accessRequestsStorage.createAccessRequest({ email: 'second@example.com', uid: 'uid-2' });
    await accessRequestsStorage.declineAccessRequest('second@example.com');

    const response = await app.inject({ method: 'GET', url: '/api/admin/access-requests/' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.requests.map((r) => r.email)).toEqual(['first@example.com', 'second@example.com']);
    expect(body.requests.map((r) => r.status)).toEqual(['pending', 'declined']);
  });

  it('returns an empty list when there are no requests', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/access-requests/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ requests: [] });
  });
});

describe('POST /api/admin/access-requests/:email/approve', () => {
  it('allowlists the email, removes the request, and never grants admin', async () => {
    await accessRequestsStorage.createAccessRequest({ email: 'waiting@example.com', uid: 'uid-waiting' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/access-requests/waiting@example.com/approve',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'waiting@example.com', status: 'approved' });

    const allowed = await allowedUsersStorage.getAllowedUser('waiting@example.com');
    expect(allowed).toMatchObject({ email: 'waiting@example.com', isAdmin: false });

    expect(await accessRequestsStorage.getAccessRequest('waiting@example.com')).toBeNull();
  });

  it('returns 404 for an email with no request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/access-requests/nobody@example.com/approve',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not found' });
    expect(await allowedUsersStorage.getAllowedUser('nobody@example.com')).toBeNull();
  });

  it('URL-decodes and lowercases the email before lookup', async () => {
    await accessRequestsStorage.createAccessRequest({ email: 'mixed-case@example.com', uid: 'uid-mixed' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/admin/access-requests/${encodeURIComponent('Mixed-Case@Example.com')}/approve`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'mixed-case@example.com', status: 'approved' });
  });
});

describe('POST /api/admin/access-requests/:email/decline', () => {
  it('declines a pending request', async () => {
    await accessRequestsStorage.createAccessRequest({ email: 'waiting@example.com', uid: 'uid-waiting' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/access-requests/waiting@example.com/decline',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'waiting@example.com', status: 'declined' });
    expect(await accessRequestsStorage.getAccessRequest('waiting@example.com')).toMatchObject({
      status: 'declined',
    });
  });

  it('returns 404 for an email with no request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/access-requests/nobody@example.com/decline',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not found' });
  });
});

describe('DELETE /api/admin/access-requests/:email', () => {
  it('removes an existing request and returns 204', async () => {
    await accessRequestsStorage.createAccessRequest({ email: 'waiting@example.com', uid: 'uid-waiting' });

    const response = await app.inject({ method: 'DELETE', url: '/api/admin/access-requests/waiting@example.com' });

    expect(response.statusCode).toBe(204);
    expect(await accessRequestsStorage.getAccessRequest('waiting@example.com')).toBeNull();
  });

  it('is idempotent for an email with no request', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/admin/access-requests/nobody@example.com' });
    expect(response.statusCode).toBe(204);
  });
});
