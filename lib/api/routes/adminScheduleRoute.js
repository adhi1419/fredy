/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { adminHook } from '../security.js';
import { RUN_INTERVAL_CHOICES_MINUTES, getRunSchedule, setRunSchedule } from '../../services/scheduler/runSchedule.js';
import logger from '../../services/logger.js';

/**
 * Parse the requested cadence. Only the fixed choices pass; anything else - a string, a float, a
 * minute count outside the list - is a 400, never coerced to the nearest allowed value.
 * @param {unknown} body
 * @returns {number|null}
 */
export function requestedIntervalMinutes(body) {
  const raw =
    body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body).intervalMinutes : undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return RUN_INTERVAL_CHOICES_MINUTES.includes(raw) ? raw : null;
}

/**
 * Admin-only control over how often Fredy searches. Reads and writes the Cloud Scheduler job
 * directly; there is no stored copy of the cadence.
 */
export default async function adminSchedulePlugin(fastify) {
  fastify.addHook('preHandler', adminHook);

  fastify.get('/', async () => getRunSchedule({ maxAgeMs: 0 }));

  fastify.post('/', async (request, reply) => {
    const minutes = requestedIntervalMinutes(request.body);
    if (minutes == null) {
      return reply.code(400).send({
        error: `intervalMinutes must be one of ${RUN_INTERVAL_CHOICES_MINUTES.join(', ')}`,
      });
    }
    try {
      const schedule = await setRunSchedule(minutes);
      logger.info(`Run schedule set to every ${minutes} minutes by ${request.currentUser?.username ?? 'admin'}`);
      return schedule;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not configured/.test(message)) return reply.code(503).send({ error: message });
      logger.warn('Failed to update the run schedule', error);
      return reply.code(502).send({ error: message });
    }
  });
}
