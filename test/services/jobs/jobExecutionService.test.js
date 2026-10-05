/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/** Optional per-test behaviour for the mocked pipeline's execute(). */
let pipelineHook = null;

describe('services/jobs/jobExecutionService', () => {
  /** @type {EventEmitter} */
  let bus;
  let calls;
  let state;

  async function initService(settings = {}) {
    const root = (await import('node:path')).resolve('.');
    const svcPath = root + '/lib/services/jobs/jobExecutionService.js';
    const busPath = root + '/lib/services/events/event-bus.js';
    const jobStoragePath = root + '/lib/services/storage/jobStorage.js';
    const userStoragePath = root + '/lib/services/storage/userStorage.js';
    const settingsStoragePath = root + '/lib/services/storage/settingsStorage.js';
    const utilsPath = root + '/lib/utils.js';
    const loggerPath = root + '/lib/services/logger.js';
    const notifyPath = root + '/lib/notification/notify.js';
    const pipelinePath = root + '/lib/FredyPipelineExecutioner.js';
    const listingsStoragePath = root + '/lib/services/storage/listingsStorage.js';

    vi.resetModules();
    vi.doMock(busPath, () => ({ bus }));
    vi.doMock(jobStoragePath, () => ({
      getJob: (id) => state.jobsById[id] || null,
      getJobs: () => state.jobsList.slice(),
      updateJobLastRunAt: (id, timestamp) => calls.lastRunUpdates.push({ id, timestamp }),
    }));
    vi.doMock(userStoragePath, () => ({
      getUsers: () => state.users.slice(),
      getUser: (id) => state.users.find((u) => u.id === id) || null,
    }));
    // The service reads settings live rather than from a snapshot handed in at startup, so demo
    // mode and working hours follow the settings UI without a restart. The mock therefore has to
    // serve what the scenario configured.
    vi.doMock(settingsStoragePath, () => ({
      getSettings: async () => settings,
    }));
    vi.doMock(utilsPath, () => ({
      getPackageVersion: async () => '0.0.0-test',
    }));
    vi.doMock(loggerPath, () => {
      const m = { debug: () => {}, info: (...args) => calls.logs.push(args), warn: () => {}, error: () => {} };
      return { default: m };
    });
    vi.doMock(listingsStoragePath, () => ({
      archiveStaleListingsForJob: async () => ({ archived: 0 }),
    }));
    vi.doMock(notifyPath, () => ({ send: async () => [] }));
    vi.doMock(pipelinePath, () => ({
      default: class {
        constructor(config, job, providerId, similarityCache, options = {}) {
          this.record = { config, job, providerId, similarityCache, options };
          calls.pipeline.push(this.record);
        }

        async execute() {
          if (pipelineHook) await pipelineHook(this.record);
        }

        async reconcile() {}
      },
    }));
    vi.doMock(root + '/lib/services/jobs/run-state.js', () => ({
      isRunning: () => false,
      markRunning: (id) => {
        calls.markRunning.push(id);
        return true;
      },
      markFinished: (id) => calls.markFinished.push(id),
    }));

    const mod = await import(svcPath);
    mod.initJobExecutionService({ providers: state.providers });
    return mod;
  }

  beforeEach(() => {
    pipelineHook = null;
    bus = new EventEmitter();
    calls = {
      markRunning: [],
      markFinished: [],
      lastRunUpdates: [],
      pipeline: [],
      logs: [],
    };
    state = {
      jobsById: {},
      jobsList: [],
      users: [],
      providers: [],
    };
  });

  it('runs only the caller-owned jobs for admins and regular users', async () => {
    state.jobsList = [
      { id: 'j1', enabled: true, userId: 'u1', provider: [] },
      { id: 'j2', enabled: true, userId: 'u2', provider: [] },
      { id: 'j3', enabled: true, userId: 'admin', provider: [] },
    ];
    state.users = [
      { id: 'u1', isAdmin: false },
      { id: 'u2', isAdmin: false },
      { id: 'admin', isAdmin: true },
    ];

    await initService();

    // Regular user: only own jobs.
    bus.emit('jobs:runAll', { userId: 'u1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(new Set(calls.markRunning)).toEqual(new Set(['j1']));

    // Admin: only the admin-owned job, not every tenant's job.
    calls.markRunning = [];
    bus.emit('jobs:runAll', { userId: 'admin' });
    await new Promise((r) => setTimeout(r, 0));
    expect(new Set(calls.markRunning)).toEqual(new Set(['j3']));
  });

  it('persists last_run_at when a job is executed', async () => {
    state.jobsById['j1'] = { id: 'j1', enabled: true, userId: 'u1', provider: [] };
    state.jobsList = [state.jobsById['j1']];
    state.users = [{ id: 'u1', isAdmin: false }];

    await initService();

    const before = Date.now();
    bus.emit('jobs:runOne', { jobId: 'j1' });
    await new Promise((r) => setTimeout(r, 0));
    const after = Date.now();

    expect(calls.lastRunUpdates.length).toBe(1);
    const [update] = calls.lastRunUpdates;
    expect(update.id).toBe('j1');
    expect(update.timestamp).toBeGreaterThanOrEqual(before);
    expect(update.timestamp).toBeLessThanOrEqual(after);
  });

  it('runs every provider in a job without ever constructing a browser', async () => {
    // Providers hand out a fresh config per run instead of mutating a shared one, so the double
    // mirrors that: createConfig() returns a new object every time it is called.
    const provider = (id, config) => ({
      metaInformation: { id },
      createConfig: vi.fn((sourceConfig, blacklist) => ({ ...config, blacklist })),
    });
    state.providers = [
      provider('provider-a', { url: 'https://a.example/', getListings: vi.fn() }),
      provider('provider-b', { url: 'https://b.example/', getListings: vi.fn() }),
      provider('provider-c', { url: 'https://c.example/', getListings: vi.fn() }),
    ];
    state.jobsById.j1 = {
      id: 'j1',
      enabled: true,
      userId: 'u1',
      provider: state.providers.map(({ metaInformation }) => ({ id: metaInformation.id })),
    };

    await initService();
    bus.emit('jobs:runOne', { jobId: 'j1' });
    await vi.waitFor(() => expect(calls.markFinished).toEqual(['j1']));

    // One pipeline per provider, each handed an options object as its 5th argument - no browser.
    expect(calls.pipeline).toHaveLength(3);
    for (const record of calls.pipeline) {
      expect(record).not.toHaveProperty('browser');
      expect(typeof record.options).toBe('object');
    }
  });

  it('emits one correlated timing summary for the complete job run', async () => {
    state.providers = [
      {
        metaInformation: { id: 'provider-1' },
        createConfig: vi.fn(() => ({ url: 'https://provider.example/', getListings: vi.fn() })),
      },
    ];
    state.jobsById.j1 = { id: 'j1', enabled: true, userId: 'u1', provider: [{ id: 'provider-1' }] };

    await initService();
    bus.emit('jobs:runOne', { jobId: 'j1' });
    await vi.waitFor(() => expect(calls.markFinished).toEqual(['j1']));

    const line = calls.logs.map(([message]) => message).find((message) => message.startsWith('PIPELINE_RUN '));
    const event = JSON.parse(line.slice('PIPELINE_RUN '.length));
    expect(event).toMatchObject({
      event: 'pipeline_run',
      schemaVersion: 1,
      jobId: 'j1',
      providerId: '*',
      runType: 'job',
      outcome: 'completed',
    });
    expect(event.stages.map(({ name }) => name)).toEqual([
      'persist-last-run',
      'provider-1:scrape',
      'provider-1:repair',
      'archive-stale-listings',
    ]);
    expect(calls.pipeline[0].options.executionId).toBe(event.executionId);
  });
});
