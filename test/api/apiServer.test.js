/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyReplyHeadersToRaw, registerHttpSupport } from '../../lib/api/http.js';

const FRONTEND_ORIGIN = 'https://pages.example.com';

let app;
let bearerCalls;

beforeEach(async () => {
  vi.stubEnv('FRONTEND_ORIGIN', FRONTEND_ORIGIN);
  bearerCalls = 0;
  app = Fastify();
  registerHttpSupport(app);
  app.get('/api/bearer', async (request) => {
    bearerCalls += 1;
    return { authorization: request.headers.authorization };
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe('GET /health', () => {
  it('returns minimal JSON and works without an Origin header', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers.vary).toBe('Origin');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('strict CORS', () => {
  it('allows the configured origin to call a bearer route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bearer',
      headers: { origin: FRONTEND_ORIGIN, authorization: 'Bearer firebase-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authorization: 'Bearer firebase-token' });
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,PUT,DELETE,OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
    expect(response.headers['access-control-max-age']).toBe('86400');
    expect(response.headers.vary).toBe('Origin');
    expect(bearerCalls).toBe(1);
  });

  it('approves an authorized preflight and returns no body', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: {
        origin: FRONTEND_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization, Content-Type',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,PUT,DELETE,OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
    expect(response.headers['access-control-max-age']).toBe('86400');
    expect(response.headers.vary).toBe('Origin');
  });

  it('rejects a different origin without reflecting it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/bearer',
      headers: { origin: 'https://attacker.example', authorization: 'Bearer attacker-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'CORS origin denied' });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
    expect(response.headers.vary).toBe('Origin');
    expect(bearerCalls).toBe(0);
  });

  it('rejects a preflight that requests an unsupported header', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: {
        origin: FRONTEND_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'Authorization, X-Not-Allowed',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'CORS preflight denied' });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers.vary).toBe('Origin');
  });

  it('rejects a preflight that requests an unsupported method', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: {
        origin: FRONTEND_ORIGIN,
        'access-control-request-method': 'PATCH',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'CORS preflight denied' });
  });
});

describe('local development CORS', () => {
  it('allows Vite-proxied requests when no production origin is configured', async () => {
    const local = Fastify();
    registerHttpSupport(local, { frontendOrigin: null });
    local.post('/api/local', async () => ({ ok: true }));
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const response = await local.inject({
        method: 'POST',
        url: '/api/local',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      process.env.NODE_ENV = previous;
      await local.close();
    }
  });
});

describe('hijacked response headers', () => {
  it('copies the approved CORS headers to an SSE raw response', () => {
    const headers = new Map([
      ['vary', 'Origin'],
      ['access-control-allow-origin', FRONTEND_ORIGIN],
      ['access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS'],
      ['access-control-allow-headers', 'Authorization,Content-Type'],
      ['access-control-max-age', '86400'],
    ]);
    const raw = { setHeader: vi.fn() };

    copyReplyHeadersToRaw({ getHeader: (name) => headers.get(name) }, raw);

    expect(raw.setHeader).toHaveBeenCalledWith('access-control-allow-origin', FRONTEND_ORIGIN);
    expect(raw.setHeader).toHaveBeenCalledWith('vary', 'Origin');
    expect(raw.setHeader).toHaveBeenCalledTimes(5);
  });
});
