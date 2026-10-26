/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/services/logger.js', () => ({
  default: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}));
vi.mock('../../../lib/services/firebaseAdmin.js', () => ({
  getGoogleAccessToken: vi.fn(async () => 'test-token'),
}));

const JOB = 'projects/fredy-test/locations/europe-west1/jobs/fredy-scrape';
const JOB_URL = `https://cloudscheduler.googleapis.com/v1/${JOB}`;

let fetchMock;
let mod;

function jobResponse(schedule) {
  return new Response(JSON.stringify({ name: JOB, schedule, timeZone: 'Etc/UTC' }), { status: 200 });
}

beforeEach(async () => {
  vi.resetModules();
  process.env.GOOGLE_CLOUD_PROJECT = 'fredy-test';
  delete process.env.SCHEDULER_LOCATION;
  delete process.env.SCHEDULER_JOB;
  fetchMock = vi.fn(async () => jobResponse('*/15 * * * *'));
  vi.stubGlobal('fetch', fetchMock);
  mod = await import('../../../lib/services/scheduler/runSchedule.js');
  mod.resetRunScheduleCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLOUD_PROJECT;
});

describe('cron <-> interval mapping', () => {
  it('writes */N for every choice except sixty minutes, which is the top of the hour', () => {
    expect(mod.cronForInterval(5)).toBe('*/5 * * * *');
    expect(mod.cronForInterval(15)).toBe('*/15 * * * *');
    expect(mod.cronForInterval(60)).toBe('0 * * * *');
  });

  it('refuses a cadence outside the fixed choices', () => {
    expect(() => mod.cronForInterval(1)).toThrow(RangeError);
    expect(() => mod.cronForInterval(7)).toThrow(RangeError);
  });

  it('reads back only the shapes it writes and reports anything else as null', () => {
    expect(mod.intervalFromCron('*/5 * * * *')).toBe(5);
    expect(mod.intervalFromCron('0 * * * *')).toBe(60);
    expect(mod.intervalFromCron('*/15  *  * * *')).toBe(15);
    expect(mod.intervalFromCron('*/7 * * * *')).toBeNull();
    expect(mod.intervalFromCron('30 2 * * *')).toBeNull();
    expect(mod.intervalFromCron(null)).toBeNull();
  });
});

describe('getRunSchedule', () => {
  it('reads the deploy script job with the ADC token and quota project', async () => {
    const schedule = await mod.getRunSchedule();

    expect(schedule).toMatchObject({ status: 'available', intervalMinutes: 15, schedule: '*/15 * * * *' });
    expect(schedule.choices).toEqual([5, 10, 15, 30, 60]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(JOB_URL);
    expect(init.headers.authorization).toBe('Bearer test-token');
    expect(init.headers['x-goog-user-project']).toBe('fredy-test');
  });

  it('serves repeat reads from memory for a minute unless a fresh read is forced', async () => {
    await mod.getRunSchedule();
    await mod.getRunSchedule();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await mod.getRunSchedule({ maxAgeMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is unavailable without a project and never calls Google', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const schedule = await mod.getRunSchedule();
    expect(schedule.status).toBe('unavailable');
    expect(schedule.reason).toMatch(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an API refusal as unavailable and keeps the last known cadence', async () => {
    await mod.getRunSchedule();
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    const schedule = await mod.getRunSchedule({ maxAgeMs: 0 });
    expect(schedule.status).toBe('unavailable');
    expect(schedule.intervalMinutes).toBe(15);
    expect(schedule.reason).toMatch(/403/);
  });

  it('honours SCHEDULER_LOCATION and SCHEDULER_JOB overrides', async () => {
    process.env.SCHEDULER_LOCATION = 'us-central1';
    process.env.SCHEDULER_JOB = 'other-job';
    expect(mod.schedulerJobName()).toBe('projects/fredy-test/locations/us-central1/jobs/other-job');
  });
});

describe('setRunSchedule', () => {
  it('patches only the schedule field and returns the job as stored', async () => {
    fetchMock.mockResolvedValueOnce(jobResponse('*/5 * * * *'));
    const schedule = await mod.setRunSchedule(5);

    expect(schedule).toMatchObject({ status: 'available', intervalMinutes: 5, schedule: '*/5 * * * *' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${JOB_URL}?updateMask=schedule`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ schedule: '*/5 * * * *' });
  });

  it('updates the cached cadence the dashboard reads', async () => {
    await mod.getRunSchedule();
    fetchMock.mockResolvedValueOnce(jobResponse('*/5 * * * *'));
    await mod.setRunSchedule(5);
    expect(await mod.runIntervalMinutes()).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an unsupported cadence before touching the API', async () => {
    await expect(mod.setRunSchedule(3)).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces an API refusal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(mod.setRunSchedule(10)).rejects.toThrow(/403/);
  });
});

describe('runIntervalMinutes', () => {
  it('falls back to fifteen minutes when nothing can be read', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    expect(await mod.runIntervalMinutes()).toBe(15);
  });

  it('falls back to fifteen minutes when the job carries a hand-edited cron', async () => {
    fetchMock.mockResolvedValueOnce(jobResponse('30 2 * * *'));
    expect(await mod.runIntervalMinutes()).toBe(15);
  });
});
