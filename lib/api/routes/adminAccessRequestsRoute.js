/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Admin routes for the access-request waitlist.
 *
 * All routes here require adminHook (applied as this plugin's own preHandler, on top of the
 * surrounding authHook group api.js registers it in): list pending/declined requests, approve one
 * onto the allowlist, decline one, or remove one outright.
 */
import { adminHook } from '../security.js';
import { upsertAllowedUser } from '../../services/storage/firestore/allowedUsersStorage.js';
import * as accessRequestsStorage from '../../services/storage/firestore/accessRequestsStorage.js';

/**
 * @param {string} raw
 * @returns {string}
 */
const normalizeEmailParam = (raw) => decodeURIComponent(raw).trim().toLowerCase();

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function adminAccessRequestsPlugin(fastify) {
  fastify.addHook('preHandler', adminHook);

  fastify.get('/', async () => ({ requests: await accessRequestsStorage.listAccessRequests() }));

  fastify.post('/:email/approve', async (request, reply) => {
    const email = normalizeEmailParam(request.params.email);
    const existing = await accessRequestsStorage.getAccessRequest(email);
    if (existing == null) {
      return reply.code(404).send({ error: 'not found' });
    }
    // Approval only ever grants allowlist membership, never admin: isAdmin is explicit and false
    // here, independent of anything the requester supplied.
    await upsertAllowedUser({ email, isAdmin: false });
    await accessRequestsStorage.removeAccessRequest(email);
    return { email, status: 'approved' };
  });

  fastify.post('/:email/decline', async (request, reply) => {
    const email = normalizeEmailParam(request.params.email);
    const declined = await accessRequestsStorage.declineAccessRequest(email);
    if (declined == null) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { email, status: 'declined' };
  });

  fastify.delete('/:email', async (request, reply) => {
    const email = normalizeEmailParam(request.params.email);
    await accessRequestsStorage.removeAccessRequest(email);
    return reply.code(204).send();
  });
}
