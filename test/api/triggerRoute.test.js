/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * POST /api/trigger — the external-scheduler entry point (Cloud Scheduler on
 * Cloud Run). The contract that matters:
 *  - unconfigured (no TRIGGER_TOKEN): 404, and the runner is NEVER invoked
 *  - wrong/missing token: 403, runner never invoked
 *  - correct token: awaits the full job run, then 200 — responding before the
 *    run completes would hand the scrape a throttled CPU on Cloud Run
 *  - a failing run surfaces as 500, not an unhandled rejection
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

const runnerCalls = [];
let runnerImpl = async () => {};

vi.mock('../../lib/services/jobs/jobExecutionService.js', () => ({
  runAllJobsForTrigger: async (options) => {
    runnerCalls.push(options);
    return runnerImpl(options);
  },
}));

describe('POST /api/trigger', () => {
  let app;

  const build = async () => {
    const plugin = (await import('../../lib/api/routes/triggerRoute.js')).default;
    const instance = Fastify();
    await instance.register(plugin, { prefix: '/api/trigger' });
    return instance;
  };

  beforeEach(async () => {
    runnerCalls.length = 0;
    runnerImpl = async () => {};
    vi.resetModules();
    app = await build();
  });

  afterEach(async () => {
    delete process.env.TRIGGER_TOKEN;
    await app.close();
  });

  it('answers 404 and never runs jobs when TRIGGER_TOKEN is not configured', async () => {
    delete process.env.TRIGGER_TOKEN;
    const res = await app.inject({ method: 'POST', url: '/api/trigger' });
    expect(res.statusCode).toBe(404);
    expect(runnerCalls).toHaveLength(0);
  });

  it('answers 403 for a missing token and never runs jobs', async () => {
    process.env.TRIGGER_TOKEN = 'secret-token';
    const res = await app.inject({ method: 'POST', url: '/api/trigger' });
    expect(res.statusCode).toBe(403);
    expect(runnerCalls).toHaveLength(0);
  });

  it('answers 403 for a wrong token and never runs jobs', async () => {
    process.env.TRIGGER_TOKEN = 'secret-token';
    const res = await app.inject({
      method: 'POST',
      url: '/api/trigger',
      headers: { 'x-trigger-token': 'wrong' },
    });
    expect(res.statusCode).toBe(403);
    expect(runnerCalls).toHaveLength(0);
  });

  it('runs all jobs (respecting working hours) and waits for completion with the right token', async () => {
    process.env.TRIGGER_TOKEN = 'secret-token';
    let resolved = false;
    runnerImpl = () => new Promise((resolve) => setTimeout(() => ((resolved = true), resolve()), 50));

    const res = await app.inject({
      method: 'POST',
      url: '/api/trigger',
      headers: { 'x-trigger-token': 'secret-token' },
    });

    expect(res.statusCode).toBe(200);
    // The response must not arrive before the run finished — that ordering is
    // the contract (Cloud Run only guarantees CPU while the request is open).
    // Assert the flag, not a millisecond floor: setTimeout(50) can be measured
    // as 49ms via timer rounding, which flakes a `>= 50` check in CI.
    expect(resolved).toBe(true);
    expect(runnerCalls).toEqual([{ respectWorkingHours: true }]);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces a failing run as 500', async () => {
    process.env.TRIGGER_TOKEN = 'secret-token';
    runnerImpl = async () => {
      throw new Error('scrape exploded');
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/trigger',
      headers: { 'x-trigger-token': 'secret-token' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().success).toBe(false);
  });
});
