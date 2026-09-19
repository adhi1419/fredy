/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../../services/logger.js';
import { getNotificationAdapters } from '../../utils.js';
import { testFire } from '../../notification/testFire.js';

const notificationAdapter = await getNotificationAdapters();

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function notificationAdapterPlugin(fastify) {
  fastify.get('/', async () => {
    return notificationAdapter.map((adapter) => adapter.config).filter(Boolean);
  });

  fastify.post('/try', async (request, reply) => {
    const { id, fields } = request.body;
    const adapter = notificationAdapter.find((adapter) => adapter.config.id === id);
    if (adapter == null) {
      return reply.code(404).send();
    }
    try {
      await testFire(adapter, fields, { userId: request.currentUser.id });
      return reply.send();
    } catch (Exception) {
      logger.error('Error during notification adapter test:', Exception);
      return reply.code(500).send({ error: String(Exception) });
    }
  });
}
