/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as userStorage from '../services/storage/userStorage.js';
import { getAllowedUser } from '../services/storage/firestore/allowedUsersStorage.js';
import { verifyIdToken } from '../services/firebaseAdmin.js';

/**
 * Extract exactly one bearer token from the Authorization header.
 *
 * Fastify normally exposes a single header as a string. Arrays and comma-joined duplicate headers
 * are rejected so a caller cannot make different layers observe different credentials.
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
 * Normalize a Firebase email claim for the allowlist lookup.
 * @param {unknown} email
 * @returns {string|null}
 */
export function normalizeVerifiedEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
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
 * Fastify preHandler hook for direct Firebase bearer authentication.
 *
 * The Firebase token is the only client-supplied identity. The allowlist is read on every request
 * so revocation and admin changes take effect immediately; its result is also synchronized onto
 * the Fredy user whose id is the Firebase UID.
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

  let decoded;
  try {
    decoded = await verifyIdToken(idToken);
  } catch {
    return reply.code(401).send({ reason: 'invalid token' });
  }

  const uid = decoded?.uid;
  const email = normalizeVerifiedEmail(decoded?.email);
  if (typeof uid !== 'string' || uid.length === 0 || email == null || decoded?.email_verified !== true) {
    return reply.code(401).send({ reason: 'invalid token claims' });
  }

  const allowed = await getAllowedUser(email);
  if (allowed == null) {
    return reply.code(403).send({ reason: 'not allowed' });
  }

  const isAdminValue = allowed.isAdmin === true;
  const existing = await userStorage.getUserIdentity(uid);
  if (existing == null || existing.username !== email || existing.isAdmin !== isAdminValue) {
    await userStorage.upsertUser({
      userId: uid,
      username: email,
      isAdmin: isAdminValue,
    });
  }
  request.currentUser = { id: uid, username: email, isAdmin: isAdminValue };
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
