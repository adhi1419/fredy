/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * POST /api/trigger — run all enabled jobs on demand.
 *
 * Built for external schedulers (Cloud Scheduler waking a scale-to-zero
 * Cloud Run instance), where Fredy's internal timer cannot exist. The request
 * is held open until the run completes: on Cloud Run, CPU is only guaranteed
 * while a request is in flight, so responding early would leave the scrape
 * running on a throttled (near-zero) CPU.
 *
 * Auth: a shared secret in the X-Trigger-Token header, compared in constant
 * time against the TRIGGER_TOKEN env var. Session auth is deliberately not
 * used — the caller is a machine, not a browser. When TRIGGER_TOKEN is not
 * configured, the endpoint answers 404 as if it did not exist (secure
 * default for classic always-on deployments that never need it).
 *
 * Working hours are respected, matching the internal scheduler's behavior —
 * a trigger outside the configured window is acknowledged but runs nothing
 * (ran: false), so the scheduler cadence can stay simple.
 */
import crypto from 'crypto';
import logger from '../../services/logger.js';
import { runAllJobsForTrigger } from '../../services/jobs/jobExecutionService.js';

/**
 * Constant-time string comparison (length leak is acceptable: token length is
 * not secret).
 */
function tokenMatches(provided, expected) {
  const a = Buffer.from(String(provided ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async function triggerPlugin(fastify) {
  fastify.post('/', async (request, reply) => {
    const expected = process.env.TRIGGER_TOKEN;
    if (!expected) {
      return reply.status(404).send({ success: false });
    }
    if (!tokenMatches(request.headers['x-trigger-token'], expected)) {
      logger.warn('Rejected /api/trigger call with missing or wrong token');
      return reply.status(403).send({ success: false });
    }

    const startedAt = Date.now();
    try {
      await runAllJobsForTrigger({ respectWorkingHours: true });
      const durationMs = Date.now() - startedAt;
      logger.info(`Triggered job run finished in ${durationMs} ms`);
      return reply.send({ success: true, durationMs });
    } catch (err) {
      logger.error('Triggered job run failed', err);
      return reply.status(500).send({ success: false, error: String(err?.message ?? err) });
    }
  });
}
