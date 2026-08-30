/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Firebase login exchange (AUTH_MODE=firebase).
 *
 * POST /api/login/firebase
 *   { idToken } -> verify (Firebase Admin) -> allowlist check -> provision
 *   or touch the Fredy user -> issue the standard Fredy session cookie.
 *   Everything after this request rides the existing session mechanism:
 *   authHook, SSE, TTL — untouched (see doc/prd-multi-tenant-auth.md).
 *
 * GET /api/login/firebase/config
 *   Public: { enabled, firebaseConfig } — the web SDK config is not a
 *   secret (it identifies the project; security comes from token
 *   verification and the allowlist). Served from FIREBASE_WEB_CONFIG (JSON)
 *   so the frontend needs no build-time configuration.
 *
 * The Firebase UID becomes the Fredy user id (no mapping table). isAdmin is
 * synced from the allowlist entry on every login, so flipping it in
 * Firestore takes effect at the next sign-in.
 */

import * as userStorage from '../../services/storage/userStorage.js';
import { getAllowedUser } from '../../services/storage/firestore/allowedUsersStorage.js';
import { verifyIdToken } from '../../services/firebaseAdmin.js';
import { isFirebaseAuth } from '../../services/authMode.js';
import logger from '../../services/logger.js';
import { createWindowLimiter, getClientIp } from '../rateLimiter.js';

const MAX_EXCHANGE_ATTEMPTS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const exchangeAttempts = createWindowLimiter(WINDOW_MS);

function firebaseWebConfig() {
  const raw = process.env.FIREBASE_WEB_CONFIG;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    logger.error('FIREBASE_WEB_CONFIG is not valid JSON');
    return null;
  }
}

export default async function firebaseLoginPlugin(fastify) {
  fastify.get('/config', async () => ({
    enabled: isFirebaseAuth(),
    firebaseConfig: isFirebaseAuth() ? firebaseWebConfig() : null,
  }));

  fastify.post('/', async (request, reply) => {
    if (!isFirebaseAuth()) {
      return reply.code(404).send();
    }
    const ip = getClientIp(request);
    if (exchangeAttempts.hit(`ip:${ip}`, MAX_EXCHANGE_ATTEMPTS)) {
      logger.error(`Firebase login rate limit exceeded for IP ${ip}`);
      return reply.code(429).send();
    }

    const idToken = request.body?.idToken;
    if (!idToken || typeof idToken !== 'string') {
      return reply.code(400).send({ reason: 'missing idToken' });
    }

    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch {
      return reply.code(401).send({ reason: 'invalid token' });
    }

    const email = decoded.email?.toLowerCase();
    if (!email) {
      return reply.code(401).send({ reason: 'token carries no email' });
    }

    const allowed = await getAllowedUser(email);
    if (!allowed) {
      logger.warn(`Firebase login rejected: ${email} is not on the allowlist`);
      return reply.code(403).send({ reason: 'not allowed' });
    }

    // Provision or sync. The Firebase UID is the Fredy user id; isAdmin
    // follows the allowlist on every login. Password is never used in this
    // mode (upsertUser stores a hash of '' on insert, which verify() can
    // never match — the password path stays locked for these accounts).
    await userStorage.upsertUser({
      userId: decoded.uid,
      username: email,
      isAdmin: allowed.isAdmin,
    });
    await userStorage.setLastLoginToNow({ userId: decoded.uid });

    request.session.currentUser = decoded.uid;
    request.session.createdAt = Date.now();
    exchangeAttempts.clear(`ip:${ip}`);
    logger.info(`Firebase login: ${email} (${allowed.isAdmin ? 'admin' : 'user'})`);
    return reply.code(200).send({ userId: decoded.uid, isAdmin: allowed.isAdmin });
  });
}
