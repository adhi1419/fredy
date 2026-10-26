/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  accessRequestPath,
  createAdminEffects,
  createAdminState,
  monitoringPath,
  orderAccessRequests,
  SCHEDULE_PATH,
  type AccessRequest,
  type RunSchedule,
  type AdminStateSetter,
} from '../../ui/src/services/state/adminState.js';

const row = (email: string, status: AccessRequest['status'], requestedAt: number): AccessRequest => ({
  email,
  displayName: null,
  uid: `uid-${email}`,
  requestedAt,
  status,
  decidedAt: status === 'declined' ? requestedAt + 1 : null,
});

function setup(initial: readonly AccessRequest[] = []) {
  const state = createAdminState();
  const get = vi.fn().mockResolvedValue({ status: 200, json: { requests: initial } });
  const post = vi.fn().mockResolvedValue({ status: 200, json: {} });
  const del = vi.fn().mockResolvedValue({ status: 204, json: {} });
  const set: AdminStateSetter = (updater) => Object.assign(state, updater(state));
  const effects = createAdminEffects(set, { get, post, delete: del });
  return { state, get, post, del, effects };
}

describe('admin state: access requests', () => {
  it('starts empty and not loaded', () => {
    expect(createAdminState()).toEqual({
      admin: {
        accessRequests: [],
        accessRequestsLoaded: false,
        monitoring: null,
        monitoringRuns: [],
        monitoringLoaded: false,
        runSchedule: null,
      },
    });
  });

  it('loads the queue and marks it loaded', async () => {
    const rows = [row('a@example.com', 'pending', 1)];
    const { state, get, effects } = setup(rows);
    await effects.getAccessRequests();
    expect(get).toHaveBeenCalledWith('/api/admin/access-requests');
    expect(state.admin).toMatchObject({ accessRequests: rows, accessRequestsLoaded: true });
  });

  it('approves, declines and removes through the per-email routes, then re-reads the queue', async () => {
    const { get, post, del, effects } = setup();
    await effects.approveAccessRequest('Bob+tag@Example.com');
    await effects.declineAccessRequest('c@example.com');
    await effects.removeAccessRequest('c@example.com');
    expect(post).toHaveBeenNthCalledWith(1, '/api/admin/access-requests/Bob%2Btag%40Example.com/approve', {});
    expect(post).toHaveBeenNthCalledWith(2, '/api/admin/access-requests/c%40example.com/decline', {});
    expect(del).toHaveBeenCalledWith('/api/admin/access-requests/c%40example.com');
    // One re-read per action, so the page never reconciles optimistic state.
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('encodes the email as one path segment', () => {
    expect(accessRequestPath('a/b@x.io')).toBe('/api/admin/access-requests/a%2Fb%40x.io');
    expect(accessRequestPath('a@x.io', 'approve')).toBe('/api/admin/access-requests/a%40x.io/approve');
  });

  it('loads Monitoring overview and selected-bucket runs through encoded query paths', async () => {
    const { state, get, effects } = setup();
    const overview = { generatedAt: 5, buckets: [] };
    get.mockResolvedValueOnce({ status: 200, json: overview });
    await effects.getMonitoring({ start: 1, end: 2, monthStart: 1, jobId: 'job/a', providerId: 'p one' });
    expect(get).toHaveBeenLastCalledWith(
      '/api/admin/monitoring?start=1&end=2&monthStart=1&jobId=job%2Fa&providerId=p+one',
    );
    expect(state.admin.monitoring).toBe(overview);
    expect(state.admin.monitoringLoaded).toBe(true);

    const runs = [{ id: 'run-1' }];
    get.mockResolvedValueOnce({ status: 200, json: { runs } });
    await effects.getMonitoringRuns({ start: 1, end: 2 });
    expect(get).toHaveBeenLastCalledWith('/api/admin/monitoring/runs?start=1&end=2');
    expect(state.admin.monitoringRuns).toEqual(runs);
  });

  it('omits empty optional Monitoring filters', () => {
    expect(monitoringPath({ start: 1, end: 2, jobId: '', providerId: null })).toBe(
      '/api/admin/monitoring?start=1&end=2',
    );
  });

  it('orders pending requests first, oldest at the top, declined after', () => {
    const ordered = orderAccessRequests([
      row('late@example.com', 'pending', 30),
      row('old-declined@example.com', 'declined', 5),
      row('early@example.com', 'pending', 10),
    ]);
    expect(ordered.map(({ email }) => email)).toEqual([
      'early@example.com',
      'late@example.com',
      'old-declined@example.com',
    ]);
  });
});

describe('admin state: run schedule', () => {
  const schedule = (intervalMinutes: RunSchedule['intervalMinutes']): RunSchedule => ({
    status: 'available',
    intervalMinutes,
    schedule: intervalMinutes == null ? '30 2 * * *' : `*/${intervalMinutes} * * * *`,
    timeZone: 'Etc/UTC',
    choices: [5, 10, 15, 30, 60],
  });

  it('is unknown until the Cloud Scheduler job has been read', () => {
    expect(createAdminState().admin.runSchedule).toBeNull();
  });

  it('reads the job through the admin schedule route', async () => {
    const { state, get, effects } = setup();
    get.mockResolvedValueOnce({ status: 200, json: schedule(15) });
    await effects.getRunSchedule();
    expect(get).toHaveBeenCalledWith(SCHEDULE_PATH);
    expect(state.admin.runSchedule?.intervalMinutes).toBe(15);
  });

  it('posts the chosen cadence and keeps what the job reports back, not what was asked', async () => {
    const { state, post, effects } = setup();
    post.mockResolvedValueOnce({ status: 200, json: schedule(5) });
    await effects.setRunSchedule(5);
    expect(post).toHaveBeenCalledWith(SCHEDULE_PATH, { intervalMinutes: 5 });
    expect(state.admin.runSchedule).toEqual(schedule(5));
  });

  it('keeps a hand-edited cron visible as a null interval with its expression', async () => {
    const { state, get, effects } = setup();
    get.mockResolvedValueOnce({ status: 200, json: schedule(null) });
    await effects.getRunSchedule();
    expect(state.admin.runSchedule?.intervalMinutes).toBeNull();
    expect(state.admin.runSchedule?.schedule).toBe('30 2 * * *');
  });
});
