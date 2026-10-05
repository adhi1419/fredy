/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../logger.js';
import { bus } from '../events/event-bus.js';
import * as jobStorage from '../storage/jobStorage.js';
import { duringWorkingHoursOrNotSet } from '../../utils.js';
import FredyPipelineExecutioner from '../../FredyPipelineExecutioner.js';
import * as similarityCache from '../similarity-check/similarityCache.js';
import { isRunning, markFinished, markRunning } from './run-state.js';
import { getSettings } from '../storage/settingsStorage.js';
import { isDemoJob } from '../demo/demoService.js';
import { runConnectivity } from '../crons/connectivity-cron.js';
import { archiveStaleListingsForJob } from '../storage/listingsStorage.js';
import { currentFirestoreUsage, withFirestoreUsageScope } from '../storage/firestore/firestoreUsage.js';
import { createPipelineRunTrace } from '../observability/pipelineRunLogger.js';

/** Set by initJobExecutionService; null until the service is initialized. */
let _triggerRunner = null;

/**
 * Run all enabled jobs and resolve when the run has completed.
 * Used by POST /api/trigger (external scheduler, e.g. Cloud Scheduler).
 *
 * @param {{respectWorkingHours?: boolean}} [options]
 * @returns {Promise<void>}
 * @throws {Error} When the job execution service has not been initialized yet.
 */
export async function runAllJobsForTrigger({ respectWorkingHours = true } = {}) {
  if (_triggerRunner == null) {
    throw new Error('Job execution service not initialized');
  }
  return _triggerRunner(respectWorkingHours);
}

/**
 * Initializes the job execution service.
 * - Registers event-bus listeners for `jobs:runAll` and `jobs:runOne`.
 * - Starts the periodic scheduler (if `intervalMs` > 0) and performs an initial run respecting working hours.
 *
 * This function is intentionally side-effectful and exposes no external API.
 *
 * @param {Object} deps - Dependencies required to initialize the service.
 * @param {Array<Object>} deps.providers - Loaded provider modules. Each module must expose `metaInformation.id` and `createConfig(sourceConfig, blacklist)`, which returns a fresh, run-scoped provider config.
 * @param {number} deps.intervalMs - Delay before the first scheduled run, in milliseconds. Every later delay is read live from the `interval` setting. If not finite or <= 0, the scheduler is not started.
 * @returns {void}
 */
export function initJobExecutionService({ providers, intervalMs }) {
  // Listen for "run all" requests. Product callers may run only their own jobs; the global
  // scheduler and external trigger use runAll without a context and intentionally scan all jobs.
  bus.on('jobs:runAll', async (payload) => {
    const userId = payload?.userId ?? null;
    if (userId) {
      logger.debug(`Running all jobs manually for user ${userId}`);
    } else {
      logger.debug('Running all jobs manually (no user provided)');
    }
    runAll(false, { userId });
  });

  // Listen for single job run requests
  bus.on('jobs:runOne', ({ jobId }) => {
    logger.debug(`Running single job manually: ${jobId}`);
    // fire and forget, do not block the bus
    runSingle(jobId);
  });

  // Expose the run loop for the external trigger endpoint (Cloud Scheduler on
  // Cloud Run). The endpoint must be able to AWAIT completion: with
  // scale-to-zero, CPU is only guaranteed while a request is in flight, so a
  // fire-and-forget run would be throttled to a crawl the moment the response
  // is sent.
  _triggerRunner = (respectWorkingHours = true) => runAll(respectWorkingHours);

  // External-scheduler mode (EXTERNAL_SCHEDULER=true): the internal timer AND
  // the startup run are skipped — every scrape is driven by POST /api/trigger.
  // Without this, each Cloud Run cold start would scrape once on boot and once
  // via the trigger that woke it.
  const externalScheduler = process.env.EXTERNAL_SCHEDULER === 'true';

  // Start scheduler and initial run.
  //
  // Self-rescheduling rather than a fixed setInterval, so changing the interval in the settings UI
  // takes effect on the next tick instead of requiring a restart. `intervalMs` is only the first
  // delay; every one after it comes from the live setting.
  if (!externalScheduler && Number.isFinite(intervalMs) && intervalMs > 0) {
    let timer = setTimeout(async function tick() {
      try {
        await runAll(true);
      } catch (err) {
        logger.error('Scheduled run failed', err);
      }
      const liveSettings = await getSettings();
      const minutes = Number(liveSettings?.interval);
      const nextDelay = (Number.isFinite(minutes) && minutes > 0 ? minutes : intervalMs / 60000) * 60_000;
      timer = setTimeout(tick, nextDelay);
      // Do not hold the process open just for the next scan.
      timer.unref?.();
    }, intervalMs);
    timer.unref?.();
  }
  // start once at startup, respecting working hours (skipped in external-scheduler mode)
  if (!externalScheduler) {
    runAll(true);
  }

  /**
   * Execute all enabled jobs, optionally filtering by product caller and respecting working hours.
   *
   * @param {boolean} [respectWorkingHours=true] - If true, skip execution when outside configured working hours.
   * @param {{userId?: string}} [context] - Product caller; only its own jobs are eligible.
   * @returns {void}
   */
  async function runAll(respectWorkingHours = true, context = undefined) {
    return withFirestoreUsageScope('trigger', async () => {
      const now = Date.now();
      // Read live rather than from the object handed in at startup, so working hours and demo mode
      // follow the settings UI without a restart.
      const liveSettings = await getSettings();
      const withinHours = duringWorkingHoursOrNotSet(liveSettings, now);
      if (respectWorkingHours && !withinHours) {
        logger.debug('Working hours set. Skipping as outside of working hours.');
        return;
      }
      const allJobs = await jobStorage.getJobs();
      const jobs = [];
      for (const job of allJobs) {
        // A demo instance runs exactly one job, no matter who asked. Anything a visitor created
        // stays inert and is removed again by the nightly demo cleanup.
        if (liveSettings.demoMode) {
          if (isDemoJob(job.id)) jobs.push(job);
        } else if (!context) {
          jobs.push(job); // startup/cron → all
        } else if (context.userId && job.userId === context.userId) {
          jobs.push(job); // product caller → own jobs only
        }
      }

      try {
        for (const job of jobs) {
          await executeJob(job);
        }
      } finally {
        runConnectivity();
        const usage = currentFirestoreUsage();
        if (usage) {
          logger.info(`Firestore usage for run: reads=${usage.reads} writes=${usage.writes} jobs=${jobs.length}`);
        }
      }
    });
  }

  /**
   * Execute a single job by id.
   * Manual runs are allowed even if the job is disabled, but never duplicated when already running.
   *
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async function runSingle(jobId) {
    const liveSettings = await getSettings();
    if (liveSettings.demoMode && !isDemoJob(jobId)) return;
    const job = await jobStorage.getJob(jobId);
    if (!job) return;
    await executeJob(job);
  }

  /**
   * Executes one job across all of its configured providers.
   * Ensures the run-state guard is always cleared.
   * Provider errors are surfaced via logging but do not abort other providers.
   *
   * @param {Object} job
   * @param {string} job.id
   * @param {Array<{id:string}>} job.provider
   * @param {Array<string>} [job.blacklist]
   * @param {*} job.notificationAdapter
   * @returns {Promise<void>}
   */
  async function executeJob(job) {
    if (isRunning(job.id)) {
      logger.debug(`Job ${job.id} is already running. Skipping.`);
      return;
    }
    const acquired = markRunning(job.id);
    if (!acquired) return;
    const trace = createPipelineRunTrace({
      jobId: job.id,
      providerId: '*',
      runType: 'job',
    });
    let runOutcome = 'completed';
    let runError = null;
    // Persist the trigger time so the dashboard "last search" KPI can be
    // derived per accessible user without an in-memory cache.
    try {
      await trace.stage('persist-last-run', null, () => jobStorage.updateJobLastRunAt(job.id, Date.now()));
    } catch (err) {
      logger.warn('Failed to persist last_run_at for job', job.id, err);
    }
    try {
      const jobProviders = job.provider.filter(
        (p) => providers.find((loaded) => loaded.metaInformation.id === p.id) != null,
      );
      for (const prov of jobProviders) {
        try {
          const matchedProvider = providers.find((loaded) => loaded.metaInformation.id === prov.id);
          // A fresh config per run. The provider modules used to keep the URL and the blacklist in
          // module scope, so a second job starting while this one was mid-flight overwrote them and
          // its listings were stored under the wrong job.
          const providerConfig = matchedProvider.createConfig({ ...prov, userId: job.userId }, job.blacklist);

          const executioner = new FredyPipelineExecutioner(providerConfig, job, prov.id, similarityCache, {
            providerSource: prov,
            applicationCapability: matchedProvider.metaInformation?.capabilities?.application,
            executionId: trace.executionId,
          });
          await trace.stage(`${prov.id}:scrape`, null, () => executioner.execute());
          // Second pass on the SAME provider config: reconcile the KNOWN listings a scrape never
          // revisits and repair eligible state. A run is a repeatable "search + reconcile +
          // safely-act" pass; a second identical run leaves the external world unchanged because
          // every repair the first pass applied is now a no-op and the only external action goes
          // through the reserveInquirySend barrier.
          await trace.stage(`${prov.id}:repair`, null, () => executioner.reconcile());
        } catch (err) {
          runOutcome = 'partial-failure';
          runError ??= err;
          logger.error(err);
        }
      }
    } finally {
      markFinished(job.id);
      // One-week auto-archive. A run is the moment a job's listings are looked at as a set, so it is
      // also where anything that has aged past a week is moved to Archived. Scoped to this job (one
      // owner), it never crosses the per-user lifecycle boundary; it is a lifecycle move, never a
      // delete; and it is idempotent, so re-running the job re-archives nothing. Guarded so a sweep
      // failure can never fail the run whose listings just went out.
      try {
        const { archived } = await trace.stage('archive-stale-listings', null, () =>
          archiveStaleListingsForJob(job.id),
        );
        if (archived > 0) {
          logger.debug(`Auto-archived ${archived} stale listing(s) for job ${job.id}`);
        }
      } catch (err) {
        runOutcome = 'partial-failure';
        runError ??= err;
        logger.warn('Failed to auto-archive stale listings for job', job.id, err);
      }
      trace.finish(runOutcome, runError);
    }
  }
}
