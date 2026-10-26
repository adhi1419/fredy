/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

/** Optional per-test behaviour for the mocked pipeline's execute(). */
let pipelineHook = null;
let monitoringHook = null;

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
    const monitoringStoragePath = root + '/lib/services/storage/firestore/monitoringStorage.js';

    vi.resetModules();
    vi.doMock(busPath, () => ({ bus }));
    vi.doMock(jobStoragePath, () => ({
      getJob: (id) => {
        calls.contextReads.job += 1;
        return state.jobsById[id] || null;
      },
      getJobs: () => state.jobsList.slice(),
      updateJobLastRunAt: (id, timestamp, options = {}) =>
        calls.lastRunUpdates.push({ id, timestamp, archiveSweepAt: options.archiveSweepAt ?? null }),
    }));
    vi.doMock(userStoragePath, () => ({
      getUsers: () => state.users.slice(),
      getUser: async (id) => {
        calls.contextReads.user += 1;
        return state.users.find((u) => u.id === id) || null;
      },
    }));
    // The service reads settings live rather than from a snapshot handed in at startup, so demo
    // mode and working hours follow the settings UI without a restart. The mock therefore has to
    // serve what the scenario configured.
    vi.doMock(settingsStoragePath, () => ({
      getSettings: async () => settings,
      getUserSettings: async (id) => {
        calls.contextReads.userSettings += 1;
        return state.userSettingsById[id] || {};
      },
    }));
    vi.doMock(utilsPath, () => ({
      getPackageVersion: async () => '0.0.0-test',
    }));
    vi.doMock(loggerPath, () => {
      const m = { debug: () => {}, info: (...args) => calls.logs.push(args), warn: () => {}, error: () => {} };
      return { default: m };
    });
    vi.doMock(listingsStoragePath, () => ({
      archiveStaleListingsForJob: async (jobId) => {
        calls.archiveSweeps.push(jobId);
        return { archived: 0 };
      },
    }));
    vi.doMock(monitoringStoragePath, () => ({
      recordProviderRun: async (run) => {
        calls.monitoringRuns.push(run);
        if (monitoringHook) await monitoringHook(run);
      },
    }));
    vi.doMock(notifyPath, () => ({ send: async () => [] }));
    vi.doMock(pipelinePath, () => ({
      default: class {
        constructor(config, job, providerId, similarityCache, options = {}) {
          this.record = { config, job, providerId, similarityCache, options };
          calls.pipeline.push(this.record);
        }

        async execute() {
          if (this.record.options.executionContext) await this.record.options.executionContext;
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
    monitoringHook = null;
    bus = new EventEmitter();
    calls = {
      markRunning: [],
      markFinished: [],
      lastRunUpdates: [],
      archiveSweeps: [],
      pipeline: [],
      logs: [],
      monitoringRuns: [],
      contextReads: { job: 0, user: 0, userSettings: 0 },
    };
    state = {
      jobsById: {},
      jobsList: [],
      users: [],
      userSettingsById: {},
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

  describe('daily auto-archive sweep gate', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    async function runJobWithMarker(lastArchiveSweepAt) {
      state.jobsById.j1 = { id: 'j1', enabled: true, userId: 'u1', provider: [], lastArchiveSweepAt };
      state.users = [{ id: 'u1', isAdmin: false }];
      await initService();
      bus.emit('jobs:runOne', { jobId: 'j1' });
      await vi.waitFor(() => expect(calls.markFinished).toEqual(['j1']));
      const line = calls.logs.map(([message]) => message).find((message) => message.startsWith('PIPELINE_RUN '));
      return JSON.parse(line.slice('PIPELINE_RUN '.length));
    }

    it('sweeps a never-swept job and stamps the marker in the same write as lastRunAt', async () => {
      const event = await runJobWithMarker(null);

      expect(calls.archiveSweeps).toEqual(['j1']);
      expect(calls.lastRunUpdates).toHaveLength(1);
      const [update] = calls.lastRunUpdates;
      expect(update.archiveSweepAt).toBe(update.timestamp);
      expect(event.stages.map(({ name }) => name)).toContain('archive-stale-listings');
    });

    it('skips the sweep, the stage and the marker when the job was swept less than a day ago', async () => {
      const event = await runJobWithMarker(Date.now() - DAY_MS / 2);

      expect(calls.archiveSweeps).toEqual([]);
      expect(calls.lastRunUpdates).toHaveLength(1);
      expect(calls.lastRunUpdates[0].archiveSweepAt).toBeNull();
      expect(event.stages.map(({ name }) => name)).toEqual(['persist-last-run']);
    });

    it('sweeps again once the marker is a day old', async () => {
      await runJobWithMarker(Date.now() - DAY_MS - 1);

      expect(calls.archiveSweeps).toEqual(['j1']);
      expect(calls.lastRunUpdates[0].archiveSweepAt).toBe(calls.lastRunUpdates[0].timestamp);
    });
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
      expect(record.options.monitoringCounters).toMatchObject({ newListings: 0, providerConfirmed: 0 });
    }
    expect(calls.monitoringRuns).toHaveLength(3);
    expect(calls.monitoringRuns.map(({ providerId }) => providerId)).toEqual([
      'provider-a',
      'provider-b',
      'provider-c',
    ]);
  });

  it('continues provider searches when Monitoring persistence fails', async () => {
    const provider = (id) => ({
      metaInformation: { id },
      createConfig: vi.fn(() => ({ url: `https://${id}.example/`, getListings: vi.fn() })),
    });
    state.providers = [provider('provider-a'), provider('provider-b')];
    state.jobsById.j1 = {
      id: 'j1',
      enabled: true,
      userId: 'u1',
      provider: state.providers.map(({ metaInformation }) => ({ id: metaInformation.id })),
    };
    monitoringHook = async (run) => {
      if (run.providerId === 'provider-a') throw new Error('monitoring unavailable');
    };

    await initService();
    bus.emit('jobs:runOne', { jobId: 'j1' });
    await vi.waitFor(() => expect(calls.markFinished).toEqual(['j1']));

    expect(calls.pipeline.map(({ providerId }) => providerId)).toEqual(['provider-a', 'provider-b']);
    expect(calls.monitoringRuns.map(({ providerId }) => providerId)).toEqual(['provider-a', 'provider-b']);
  });

  it('loads execution context once per job and shares it with every provider', async () => {
    const provider = (id) => ({
      metaInformation: { id },
      createConfig: vi.fn(() => ({ url: `https://${id}.example/`, getListings: vi.fn() })),
    });
    state.providers = [provider('provider-a'), provider('provider-b'), provider('provider-c')];
    state.users = [{ id: 'u1', username: 'u1@example.com' }];
    state.userSettingsById = { u1: { language: 'de' } };
    state.jobsById.j1 = {
      id: 'j1',
      enabled: true,
      userId: 'u1',
      provider: state.providers.map(({ metaInformation }) => ({ id: metaInformation.id })),
    };

    await initService();
    bus.emit('jobs:runOne', { jobId: 'j1' });
    await vi.waitFor(() => expect(calls.markFinished).toEqual(['j1']));

    const contexts = calls.pipeline.map(({ options }) => options.executionContext);
    expect(contexts).toHaveLength(3);
    expect(new Set(contexts).size).toBe(1);
    await contexts[0];
    expect(calls.contextReads).toEqual({ job: 1, user: 1, userSettings: 1 });
    await expect(contexts[0]).resolves.toEqual({
      job: state.jobsById.j1,
      user: state.users[0],
      userSettings: state.userSettingsById.u1,
    });
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
