/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The maintenance sweeps that used to hang off in-process `node-cron` schedules.
 *
 * Fredy runs on Cloud Run with scale-to-zero: between requests the instance is frozen or gone, so a
 * timer that fires "every four hours at :00" fires only when a request happens to be in flight at
 * that moment — in practice almost never — while the run-on-start half of each cron ran on every cold
 * start instead. The honest clock Fredy has is the external scheduler calling `POST /api/trigger`
 * every few minutes, so the sweeps run from there: after the job run, each sweep whose pace has
 * elapsed since its last recorded run goes once. The pace is a minimum gap, not a schedule.
 *
 * Last-run markers are stored in the global `settings` scope (`maintenance.lastRunAt`), not in
 * process memory, because process memory does not survive a scale-to-zero.
 *
 * Nothing here deletes anything. Listings that age out are moved to Archived by the per-job sweep
 * in the pipeline (see `archiveStaleListingsForJob`); there is no retention purge.
 */

import { getListingsToGeocode, updateListingGeocoordinates } from '../storage/listingsStorage.js';
import { geocodeAddress, isGeocodingPaused } from '../geocoding/geoCodingService.js';
import { getCountriesForProvider } from '../providers/providerCountries.js';
import { getJobs } from '../storage/jobStorage.js';
import { calculateDistanceForJob } from '../geocoding/distanceService.js';
import runActiveChecker from '../listings/listingActiveService.js';
import runTravelTimeSweep from '../listings/travelTimeSweeper.js';
import { getSettings, upsertSettings } from '../storage/settingsStorage.js';
import logger from '../logger.js';

/** The settings key under which the per-sweep last-run timestamps live. */
export const MAINTENANCE_SETTING = 'maintenance.lastRunAt';

/**
 * Minimum gap between two runs of each sweep, in milliseconds. Geocoding has no gap: it is cheap,
 * bounded by what is missing, and a new listing should get its pin on the next trigger.
 * @type {Readonly<{geocode: number, aliveCheck: number, travelTimes: number}>}
 */
export const MAINTENANCE_PACE_MS = Object.freeze({
  geocode: 0,
  aliveCheck: 4 * 60 * 60 * 1000,
  travelTimes: 2 * 60 * 60 * 1000,
});

let geocodeRunning = false;
let aliveRunning = false;
let travelRunning = false;

/**
 * Geocode every listing still without coordinates, then refresh the distance to home for every job.
 * Also called directly when a user changes their home address.
 *
 * @returns {Promise<boolean>} False when a sweep was already in flight and this one was skipped.
 */
export async function runGeoCordTask() {
  if (geocodeRunning) {
    logger.debug('Geocoding sweep already running. Skipping this trigger.');
    return false;
  }
  geocodeRunning = true;
  try {
    const listings = await getListingsToGeocode();
    for (const listing of listings) {
      if (isGeocodingPaused()) break;
      const coords = await geocodeAddress(listing.address, await getCountriesForProvider(listing.provider));
      if (coords) {
        await updateListingGeocoordinates(listing.id, coords.lat, coords.lng);
      }
    }
    const jobs = await getJobs();
    for (const job of jobs) {
      await calculateDistanceForJob(job.id, job.userId);
    }
    return true;
  } finally {
    geocodeRunning = false;
  }
}

/**
 * Probe stored listings for being still online. Errors are logged, never thrown.
 * @returns {Promise<boolean>} False when skipped because a probe was already running.
 */
export async function runAliveCheck() {
  if (aliveRunning) {
    logger.debug('Active checker still running. Skipping this trigger.');
    return false;
  }
  aliveRunning = true;
  try {
    await runActiveChecker();
    return true;
  } catch (err) {
    logger.error('Active checker failed', err);
    return true;
  } finally {
    aliveRunning = false;
  }
}

/**
 * Fill in missing or stale travel times. Errors are logged, never thrown.
 * @returns {Promise<boolean>} False when skipped because a sweep was already running.
 */
export async function runTravelTimes() {
  if (travelRunning) {
    logger.debug('Travel time sweep is still running. Skipping this trigger.');
    return false;
  }
  travelRunning = true;
  try {
    await runTravelTimeSweep();
    return true;
  } catch (err) {
    logger.warn('Travel time sweep failed', err);
    return true;
  } finally {
    travelRunning = false;
  }
}

/** @returns {boolean} Whether a travel-time sweep is in flight right now. */
export function isTravelTimeSweepRunning() {
  return travelRunning;
}

/**
 * Which sweeps are due, given their last-run markers and the pace.
 *
 * Pure, so the pacing is a decision a test pins with numbers. A sweep with no marker is due.
 *
 * @param {Record<string, number>|null|undefined} lastRunAt The stored markers.
 * @param {number} now Epoch millis.
 * @param {typeof MAINTENANCE_PACE_MS} [pace]
 * @returns {Array<keyof typeof MAINTENANCE_PACE_MS>} The due sweep names, in run order.
 */
export function dueSweeps(lastRunAt, now, pace = MAINTENANCE_PACE_MS) {
  return /** @type {Array<keyof typeof MAINTENANCE_PACE_MS>} */ (Object.keys(pace)).filter((name) => {
    const last = Number(lastRunAt?.[name]);
    return !Number.isFinite(last) || now - last >= pace[name];
  });
}

const SWEEPS = Object.freeze({
  geocode: runGeoCordTask,
  aliveCheck: runAliveCheck,
  travelTimes: runTravelTimes,
});

/**
 * Run every sweep that is due and record when it ran. Called by the trigger after the job run.
 *
 * A sweep that reports it was skipped (already in flight) is not marked as run, so it is due again
 * on the next trigger. Failures inside a sweep are its own business; a failure to read or write the
 * markers is logged and the trigger's response is unaffected.
 *
 * @param {{ now?: number }} [options]
 * @returns {Promise<string[]>} The sweeps that ran.
 */
export async function runMaintenance({ now = Date.now() } = {}) {
  const ran = [];
  try {
    const settings = await getSettings();
    const markers = { ...(settings?.[MAINTENANCE_SETTING] ?? {}) };
    for (const name of dueSweeps(markers, now)) {
      const done = await SWEEPS[name]();
      if (done) {
        markers[name] = now;
        ran.push(name);
      }
    }
    if (ran.length > 0) {
      await upsertSettings({ [MAINTENANCE_SETTING]: markers });
      logger.debug(`Maintenance sweeps ran: ${ran.join(', ')}`);
    }
  } catch (err) {
    logger.warn('Maintenance sweeps failed', err);
  }
  return ran;
}
