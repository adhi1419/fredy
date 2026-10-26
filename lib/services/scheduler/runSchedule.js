/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * How often Fredy searches, read from and written to the Cloud Scheduler job that calls
 * `POST /api/trigger`.
 *
 * The Scheduler job is the single source of truth for the cadence: there is no copy of it in
 * Fredy's settings to drift out of step, and the dashboard's "next run" line reads the same job the
 * admin control writes. Access is one REST call each way over the runtime identity's Application
 * Default Credentials, the same way `googleCloudUsage.js` reads Cloud Monitoring; the identity only
 * holds `cloudscheduler.jobs.get` and `cloudscheduler.jobs.update` (see scripts/deploy-cloud-run.sh),
 * so it can re-time the job but neither create, pause nor delete one.
 *
 * Only a fixed set of cadences is accepted. The cheapest one, five minutes, is the floor that the
 * free tier still covers (see docs/roadmap/cost-and-schema-health.md); accepting an arbitrary cron
 * expression would let a single select blow that budget.
 */

import { getGoogleAccessToken } from '../firebaseAdmin.js';
import logger from '../logger.js';

/** Cadences the admin control offers, in minutes. */
export const RUN_INTERVAL_CHOICES_MINUTES = Object.freeze([5, 10, 15, 30, 60]);

/** What the dashboard assumes when the Scheduler job cannot be read (local runs, no project). */
export const DEFAULT_RUN_INTERVAL_MINUTES = 15;

/** How long a successful read is served from memory before the job is asked again. */
const CACHE_TTL_MS = 60 * 1000;

/** @type {{ intervalMinutes: number, schedule: string, timeZone: string|null, readAt: number } | null} */
let cached = null;

function projectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.FIRESTORE_PROJECT_ID || null
  );
}

/**
 * Fully qualified Cloud Scheduler job name, or null when this process has no project to ask.
 * Location and job id follow what scripts/deploy-cloud-run.sh creates; both can be overridden.
 * @returns {string|null}
 */
export function schedulerJobName() {
  const project = projectId();
  if (!project) return null;
  const location = process.env.SCHEDULER_LOCATION || 'europe-west1';
  const job = process.env.SCHEDULER_JOB || 'fredy-scrape';
  return `projects/${project}/locations/${location}/jobs/${job}`;
}

/**
 * The cron expression for a cadence. Sixty minutes is `0 * * * *`, not `*\/60`, which cron
 * rejects.
 * @param {number} minutes One of {@link RUN_INTERVAL_CHOICES_MINUTES}.
 * @returns {string}
 */
export function cronForInterval(minutes) {
  if (!RUN_INTERVAL_CHOICES_MINUTES.includes(minutes)) {
    throw new RangeError(`unsupported run interval: ${minutes}`);
  }
  return minutes === 60 ? '0 * * * *' : `*/${minutes} * * * *`;
}

/**
 * The cadence a cron expression encodes, or null when it is not one Fredy writes (someone edited
 * the job by hand) - the UI then shows the raw expression instead of a wrong number.
 * @param {string|null|undefined} schedule
 * @returns {number|null}
 */
export function intervalFromCron(schedule) {
  if (typeof schedule !== 'string') return null;
  const normalized = schedule.trim().replace(/\s+/g, ' ');
  if (normalized === '0 * * * *') return 60;
  const match = /^\*\/(\d{1,2}) \* \* \* \*$/.exec(normalized);
  if (!match) return null;
  const minutes = Number(match[1]);
  return RUN_INTERVAL_CHOICES_MINUTES.includes(minutes) ? minutes : null;
}

async function googleJson(url, init = {}) {
  const token = await getGoogleAccessToken();
  const quotaProject = projectId();
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloud Scheduler API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function remember(job) {
  cached = {
    intervalMinutes: intervalFromCron(job.schedule),
    schedule: job.schedule ?? null,
    timeZone: job.timeZone ?? null,
    readAt: Date.now(),
  };
  return cached;
}

/** Drop the in-memory copy. Exposed for tests. */
export function resetRunScheduleCache() {
  cached = null;
}

/**
 * @typedef {Object} RunSchedule
 * @property {'available'|'unavailable'} status `unavailable` when there is no project to ask or
 *   the Scheduler API refused; `reason` says which.
 * @property {number|null} intervalMinutes The cadence, or null when the job's cron is not one of
 *   the supported shapes.
 * @property {string|null} schedule The job's raw cron expression.
 * @property {string|null} timeZone The job's time zone.
 * @property {readonly number[]} choices {@link RUN_INTERVAL_CHOICES_MINUTES}.
 * @property {string} [reason]
 */

/**
 * Read the Scheduler job's cadence. A successful read is served from memory for a minute so the
 * dashboard does not round-trip to the Scheduler API on every page view.
 * @param {{ maxAgeMs?: number }} [options] Pass 0 to force a fresh read.
 * @returns {Promise<RunSchedule>}
 */
export async function getRunSchedule({ maxAgeMs = CACHE_TTL_MS } = {}) {
  const name = schedulerJobName();
  if (!name) {
    return {
      status: 'unavailable',
      intervalMinutes: null,
      schedule: null,
      timeZone: null,
      choices: RUN_INTERVAL_CHOICES_MINUTES,
      reason: 'Google Cloud project is not configured',
    };
  }
  if (cached && Date.now() - cached.readAt < maxAgeMs) {
    return { status: 'available', ...cached, choices: RUN_INTERVAL_CHOICES_MINUTES };
  }
  try {
    const job = await googleJson(`https://cloudscheduler.googleapis.com/v1/${name}`);
    return { status: 'available', ...remember(job), choices: RUN_INTERVAL_CHOICES_MINUTES };
  } catch (error) {
    // Not cached: the next read tries again. Logged because the usual cause is a missing IAM grant
    // on the runtime identity, which an operator has to fix.
    logger.warn('Could not read the Cloud Scheduler job', error);
    return {
      status: 'unavailable',
      intervalMinutes: cached?.intervalMinutes ?? null,
      schedule: cached?.schedule ?? null,
      timeZone: cached?.timeZone ?? null,
      choices: RUN_INTERVAL_CHOICES_MINUTES,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Re-time the Scheduler job. Only the `schedule` field is in the update mask, so the target URL,
 * token header and attempt deadline the deploy script configured are untouched.
 * @param {number} minutes One of {@link RUN_INTERVAL_CHOICES_MINUTES}.
 * @returns {Promise<RunSchedule>} The job as the API returned it after the update.
 * @throws {RangeError} For a cadence outside the supported choices.
 * @throws {Error} When no project is configured or the Scheduler API refused.
 */
export async function setRunSchedule(minutes) {
  const schedule = cronForInterval(minutes);
  const name = schedulerJobName();
  if (!name) throw new Error('Google Cloud project is not configured');
  const job = await googleJson(`https://cloudscheduler.googleapis.com/v1/${name}?updateMask=schedule`, {
    method: 'PATCH',
    body: JSON.stringify({ schedule }),
  });
  return { status: 'available', ...remember(job), choices: RUN_INTERVAL_CHOICES_MINUTES };
}

/**
 * The cadence the dashboard should assume for "next run": the Scheduler job's when it can be read,
 * otherwise the last value read in this process, otherwise {@link DEFAULT_RUN_INTERVAL_MINUTES}.
 * Never throws.
 * @returns {Promise<number>}
 */
export async function runIntervalMinutes() {
  const current = await getRunSchedule();
  return current.intervalMinutes ?? DEFAULT_RUN_INTERVAL_MINUTES;
}
