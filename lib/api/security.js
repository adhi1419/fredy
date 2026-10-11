/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import {
  IdentityFailure,
  normalizeVerifiedEmail,
  resolveFirebaseIdentity,
  resolveVerifiedIdentity,
} from '../services/security/firebaseIdentity.js';

// normalizeVerifiedEmail is identity policy; re-exported here for backwards compatibility with
// callers and tests that import it from the security adapter.
export { normalizeVerifiedEmail };

/**
 * Extract exactly one bearer token from the Authorization header.
 *
 * This is HTTP/Fastify adapter behavior: Fastify normally exposes a single header as a string, and
 * arrays and comma-joined duplicate headers are rejected so a caller cannot make different layers
 * observe different credentials.
 * @param {import('fastify').FastifyRequest} request
 * @returns {string|null}
 */
export function parseBearerToken(request) {
  const value = request.headers?.authorization;
  if (Array.isArray(value)) {
    if (value.length !== 1 || typeof value[0] !== 'string') return null;
    return /^Bearer ([^\s]+)$/i.exec(value[0])?.[1] ?? null;
  }
  if (typeof value !== 'string') return null;

  const rawHeaders = request.raw?.rawHeaders;
  if (Array.isArray(rawHeaders)) {
    const authorizationHeaderCount = rawHeaders.filter(
      (_, index) => index % 2 === 0 && rawHeaders[index].toLowerCase() === 'authorization',
    ).length;
    if (authorizationHeaderCount > 1) return null;
  }

  return /^Bearer ([^\s]+)$/i.exec(value)?.[1] ?? null;
}

/**
 * Returns true when the request identity has admin privileges from the current allowlist entry.
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isAdmin(request) {
  return request.currentUser?.isAdmin === true;
}

/**
 * Map a domain identity-failure reason to its wire response, applied to the reply.
 * @param {import('fastify').FastifyReply} reply
 * @param {import('../services/security/firebaseIdentity.js').IdentityFailure} reason
 */
function sendIdentityFailure(reply, reason) {
  switch (reason) {
    case IdentityFailure.NOT_ALLOWED:
      return reply.code(403).send({ reason: 'not allowed' });
    case IdentityFailure.INVALID_CLAIMS:
      return reply.code(401).send({ reason: 'invalid token claims' });
    case IdentityFailure.INVALID_TOKEN:
    default:
      return reply.code(401).send({ reason: 'invalid token' });
  }
}

/**
 * Fastify preHandler adapter for direct Firebase bearer authentication.
 *
 * The adapter owns the HTTP concerns: it clears stale request state, parses the single bearer
 * token, delegates verification/allowlist/admin/synchronization policy to the identity resolver,
 * and maps the domain result to Fastify's reply interface.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function authHook(request, reply) {
  delete request.currentUser;
  const idToken = parseBearerToken(request);
  if (idToken == null) {
    return reply.code(401).send({ reason: 'invalid authorization' });
  }

  const result = await resolveFirebaseIdentity(idToken);
  if (!result.ok) {
    return sendIdentityFailure(reply, result.reason);
  }
  request.currentUser = result.currentUser;
}

/**
 * Fastify preHandler adapter for direct Firebase bearer authentication without the allowlist gate.
 *
 * Verifies the bearer token exactly like {@link authHook} - same parsing, same 401 bodies on
 * failure - but stops before the allowlist lookup and sets `request.verifiedIdentity` instead of
 * `request.currentUser`. Routes behind this hook authenticate the caller without implying they are
 * allowlisted; the access-request waitlist routes are the only ones that need that distinction.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function verifiedIdentityHook(request, reply) {
  delete request.verifiedIdentity;
  const idToken = parseBearerToken(request);
  if (idToken == null) {
    return reply.code(401).send({ reason: 'invalid authorization' });
  }

  const result = await resolveVerifiedIdentity(idToken);
  if (!result.ok) {
    return sendIdentityFailure(reply, result.reason);
  }
  request.verifiedIdentity = result.identity;
}

/**
 * Fastify preHandler hook - rejects non-admin requests with 401.
 * Apply after authHook.
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export async function adminHook(request, reply) {
  if (!isAdmin(request)) {
    return reply.code(403).send();
  }
}
