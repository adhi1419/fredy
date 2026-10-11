/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const getMonitoringOverview = vi.fn();
const getMonitoringRuns = vi.fn();
vi.mock('../../lib/services/monitoring/monitoringService.js', () => ({ getMonitoringOverview, getMonitoringRuns }));

const ADMIN = { id: 'admin', username: 'admin@example.com', isAdmin: true };
const NON_ADMIN = { id: 'user', username: 'user@example.com', isAdmin: false };
let currentUser = ADMIN;
let app;

async function buildApp() {
  const plugin = (await import('../../lib/api/routes/adminMonitoringRoute.js')).default;
  const instance = Fastify();
  instance.addHook('preHandler', async (request) => {
    request.currentUser = currentUser;
  });
  await instance.register(plugin, { prefix: '/api/admin/monitoring' });
  return instance;
}

beforeEach(async () => {
  currentUser = ADMIN;
  getMonitoringOverview.mockReset().mockResolvedValue({ buckets: [] });
  getMonitoringRuns.mockReset().mockResolvedValue({ runs: [] });
  app = await buildApp();
});

afterEach(async () => {
  await app?.close();
});

describe('admin Monitoring API', () => {
  it('rejects non-admin callers before loading monitoring data', async () => {
    currentUser = NON_ADMIN;
    const response = await app.inject({ method: 'GET', url: '/api/admin/monitoring/' });
    expect(response.statusCode).toBe(403);
    expect(getMonitoringOverview).not.toHaveBeenCalled();
  });

  it('passes a bounded range and optional filters to the service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/monitoring/?start=1000&end=5000&monthStart=2000&jobId=j1&providerId=p1',
    });
    expect(response.statusCode).toBe(200);
    expect(getMonitoringOverview).toHaveBeenCalledWith({
      start: 1000,
      end: 5000,
      monthStart: 2000,
      jobId: 'j1',
      providerId: 'p1',
    });
  });

  it('rejects invalid and overlong ranges', async () => {
    const reversed = await app.inject({ method: 'GET', url: '/api/admin/monitoring/?start=5000&end=1000' });
    const tooLong = await app.inject({
      method: 'GET',
      url: `/api/admin/monitoring/?start=1&end=${33 * 24 * 60 * 60 * 1000}`,
    });
    expect(reversed.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
  });

  it('loads only the selected bucket runs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/monitoring/runs?start=1000&end=5000&jobId=j1',
    });
    expect(response.statusCode).toBe(200);
    expect(getMonitoringRuns).toHaveBeenCalledWith({
      start: 1000,
      end: 5000,
      monthStart: 1000,
      jobId: 'j1',
      providerId: null,
    });
  });
});
