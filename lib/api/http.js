/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']);
const ALLOWED_HEADERS = new Set(['authorization', 'content-type']);
const ALLOW_METHODS_HEADER = 'GET,POST,PUT,DELETE,OPTIONS';
const ALLOW_HEADERS_HEADER = 'Authorization,Content-Type';

function parseHeaderList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedPreflight(request) {
  const requestedMethod = request.headers['access-control-request-method'];
  if (typeof requestedMethod !== 'string' || !ALLOWED_METHODS.has(requestedMethod.toUpperCase())) {
    return false;
  }

  return parseHeaderList(request.headers['access-control-request-headers']).every((header) =>
    ALLOWED_HEADERS.has(header),
  );
}

/**
 * Register the HTTP surface shared by the API server.
 *
 * Requests without an Origin header are treated as same-origin. Cross-origin requests must use
 * the exact configured frontend origin; no origin is reflected when the setting is absent or does
 * not match. Preflight requests are answered only when their requested method and headers are in
 * the explicitly allowed lists.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{ frontendOrigin?: string }} [options]
 */
export function registerHttpSupport(app, { frontendOrigin = process.env.FRONTEND_ORIGIN } = {}) {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Vary', 'Origin');

    const origin = request.headers.origin;
    if (origin == null) return;

    if (typeof frontendOrigin !== 'string' || frontendOrigin.length === 0) {
      if (process.env.NODE_ENV !== 'production') return;
      return reply.code(403).send({ error: 'CORS origin denied' });
    }
    if (origin !== frontendOrigin) {
      return reply.code(403).send({ error: 'CORS origin denied' });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return reply.code(403).send({ error: 'CORS method denied' });
    }

    if (request.method === 'OPTIONS' && !isAllowedPreflight(request)) {
      return reply.code(403).send({ error: 'CORS preflight denied' });
    }

    reply.header('Access-Control-Allow-Origin', frontendOrigin);
    reply.header('Access-Control-Allow-Methods', ALLOW_METHODS_HEADER);
    reply.header('Access-Control-Allow-Headers', ALLOW_HEADERS_HEADER);
    reply.header('Access-Control-Max-Age', '86400');

    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));
}
