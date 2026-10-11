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
 *
 * GET /api/auth/access-request, POST /api/auth/access-request
 *   Protected by verifiedIdentityHook: the caller must present a valid Firebase bearer token, but
 *   need not be allowlisted yet. These are how a verified-but-not-allowlisted identity checks and
 *   records its place in the waitlist (see accessRequestsStorage.js).
 */
import { authHook, verifiedIdentityHook } from '../security.js';
import { getAllowedUser } from '../../services/storage/firestore/allowedUsersStorage.js';
import * as accessRequestsStorage from '../../services/storage/firestore/accessRequestsStorage.js';
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
    // Local development only. The Admin SDK already honors FIREBASE_AUTH_EMULATOR_HOST natively;
    // the browser SDK has to be told explicitly, so the same host is handed to the web client.
    // The key is only present when the variable is set, so the production wire shape is unchanged.
    const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    return {
      enabled: firebaseConfig != null,
      firebaseConfig,
      ...(authEmulatorHost ? { authEmulatorHost } : {}),
    };
  });

  fastify.get('/me', { preHandler: authHook }, async (request) => ({
    userId: request.currentUser.id,
    username: request.currentUser.username,
    isAdmin: request.currentUser.isAdmin,
  }));

  fastify.get('/access-request', { preHandler: verifiedIdentityHook }, async (request) => {
    const { email } = request.verifiedIdentity;
    if ((await getAllowedUser(email)) != null) return { status: 'approved' };
    const existing = await accessRequestsStorage.getAccessRequest(email);
    return { status: existing?.status ?? 'none' };
  });

  fastify.post('/access-request', { preHandler: verifiedIdentityHook }, async (request) => {
    const { uid, email, displayName } = request.verifiedIdentity;
    if ((await getAllowedUser(email)) != null) return { status: 'approved' };
    const row = await accessRequestsStorage.createAccessRequest({ email, displayName, uid });
    return { status: row.status };
  });
}
