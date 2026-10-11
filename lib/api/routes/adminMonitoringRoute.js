/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { adminHook } from '../security.js';
import { getMonitoringOverview, getMonitoringRuns } from '../../services/monitoring/monitoringService.js';

const MAX_RANGE_MS = 32 * 24 * 60 * 60 * 1000;

function optionalFilter(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Parse and bound an admin Monitoring time range. */
export function monitoringRange(query = {}, { now = Date.now() } = {}) {
  const end = query.end == null ? now : Number(query.end);
  const start = query.start == null ? end - 7 * 24 * 60 * 60 * 1000 : Number(query.start);
  const monthStart = query.monthStart == null ? start : Number(query.monthStart);
  if (![start, end, monthStart].every(Number.isFinite)) throw new Error('timestamps must be finite numbers');
  if (start >= end) throw new Error('start must be before end');
  if (end - start > MAX_RANGE_MS) throw new Error('range cannot exceed 32 days');
  if (monthStart >= end || end - monthStart > MAX_RANGE_MS)
    throw new Error('monthStart is outside the supported range');
  return {
    start,
    end,
    monthStart,
    jobId: optionalFilter(query.jobId),
    providerId: optionalFilter(query.providerId),
  };
}

/** Admin-only cost, consumption, run aggregate, and run-detail routes. */
export default async function adminMonitoringPlugin(fastify) {
  fastify.addHook('preHandler', adminHook);

  fastify.get('/', async (request, reply) => {
    try {
      return await getMonitoringOverview(monitoringRange(request.query));
    } catch (error) {
      if (error instanceof Error && /timestamps|start|range|monthStart/.test(error.message)) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get('/runs', async (request, reply) => {
    try {
      const range = monitoringRange({ ...request.query, monthStart: request.query?.start });
      return await getMonitoringRuns(range);
    } catch (error) {
      if (error instanceof Error && /timestamps|start|range|monthStart/.test(error.message)) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
