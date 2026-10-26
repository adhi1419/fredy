/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const getRunSchedule = vi.fn();
const setRunSchedule = vi.fn();
vi.mock('../../lib/services/scheduler/runSchedule.js', () => ({
  RUN_INTERVAL_CHOICES_MINUTES: [5, 10, 15, 30, 60],
  getRunSchedule,
  setRunSchedule,
}));
vi.mock('../../lib/services/logger.js', () => ({
  default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}));

const ADMIN = { id: 'admin', username: 'admin@example.com', isAdmin: true };
const NON_ADMIN = { id: 'user', username: 'user@example.com', isAdmin: false };
let currentUser = ADMIN;
let app;

const available = (intervalMinutes) => ({
  status: 'available',
  intervalMinutes,
  schedule: `*/${intervalMinutes} * * * *`,
  timeZone: 'Etc/UTC',
  choices: [5, 10, 15, 30, 60],
});

beforeEach(async () => {
  currentUser = ADMIN;
  getRunSchedule.mockReset().mockResolvedValue(available(15));
  setRunSchedule.mockReset().mockImplementation(async (minutes) => available(minutes));
  const plugin = (await import('../../lib/api/routes/adminScheduleRoute.js')).default;
  app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await app.register(plugin, { prefix: '/api/admin/schedule' });
});

afterEach(async () => {
  await app?.close();
});

describe('admin run-schedule API', () => {
  it('rejects non-admin callers before touching the scheduler', async () => {
    currentUser = NON_ADMIN;
    const read = await app.inject({ method: 'GET', url: '/api/admin/schedule/' });
    const write = await app.inject({ method: 'POST', url: '/api/admin/schedule/', payload: { intervalMinutes: 5 } });
    expect(read.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    expect(getRunSchedule).not.toHaveBeenCalled();
    expect(setRunSchedule).not.toHaveBeenCalled();
  });

  it('reads the live job, bypassing the dashboard cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/schedule/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(available(15));
    expect(getRunSchedule).toHaveBeenCalledWith({ maxAgeMs: 0 });
  });

  it('writes a supported cadence and returns the job as stored', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/', payload: { intervalMinutes: 5 } });
    expect(response.statusCode).toBe(200);
    expect(response.json().intervalMinutes).toBe(5);
    expect(setRunSchedule).toHaveBeenCalledWith(5);
  });

  it('refuses anything outside the fixed choices with a 400 and never coerces', async () => {
    for (const payload of [
      { intervalMinutes: 1 },
      { intervalMinutes: 7 },
      { intervalMinutes: '5' },
      { intervalMinutes: 5.5 },
      {},
      null,
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/admin/schedule/', payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(setRunSchedule).not.toHaveBeenCalled();
  });

  it('maps a missing project to 503 and a Scheduler refusal to 502', async () => {
    setRunSchedule.mockRejectedValueOnce(new Error('Google Cloud project is not configured'));
    const unconfigured = await app.inject({
      method: 'POST',
      url: '/api/admin/schedule/',
      payload: { intervalMinutes: 10 },
    });
    expect(unconfigured.statusCode).toBe(503);

    setRunSchedule.mockRejectedValueOnce(new Error('Cloud Scheduler API 403: denied'));
    const refused = await app.inject({ method: 'POST', url: '/api/admin/schedule/', payload: { intervalMinutes: 10 } });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().error).toMatch(/403/);
  });
});
