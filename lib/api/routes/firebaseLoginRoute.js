/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Firebase browser-auth endpoints.
 *
 * GET /api/auth/config
 *   Public: { enabled, firebaseConfig }. The web SDK config identifies the
 *   Firebase project; authorization comes from verified bearer tokens and the
 *   server-side allowlist.
 *
 * GET /api/auth/me
 *   Protected by authHook. The hook verifies the Firebase bearer token,
 *   synchronizes the Fredy user, and attaches request.currentUser.
 */
import { authHook } from '../security.js';
import logger from '../../services/logger.js';

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

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function authPlugin(fastify) {
  fastify.get('/config', async () => {
    const firebaseConfig = firebaseWebConfig();
    return {
      enabled: firebaseConfig != null,
      firebaseConfig,
    };
  });

  fastify.get('/me', { preHandler: authHook }, async (request) => ({
    userId: request.currentUser.id,
    username: request.currentUser.username,
    isAdmin: request.currentUser.isAdmin,
  }));
}
