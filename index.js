/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { checkIfConfigIsAccessible, getProviders, refreshConfig } from './lib/utils.js';
import * as similarityCache from './lib/services/similarity-check/similarityCache.js';
import { ensureDemoUserExists, ensureAdminUserExists } from './lib/services/storage/userStorage.js';
import { initTrackerCron } from './lib/services/crons/tracker-cron.js';
import logger from './lib/services/logger.js';
import { reloadEnabledFromSettings } from './lib/services/debug/debugLogStorage.js';
import { initActiveCheckerCron } from './lib/services/crons/listing-alive-cron.js';
import { initGeocodingCron } from './lib/services/crons/geocoding-cron.js';
import { getSettings } from './lib/services/storage/settingsStorage.js';
import FirestoreConnection from './lib/services/storage/firestore/FirestoreConnection.js';
import { isFirebaseAuth, AUTH_MODE } from './lib/services/authMode.js';
import { initJobExecutionService } from './lib/services/jobs/jobExecutionService.js';
import { ensureValidBinary } from './lib/services/ensureValidBinary.js';
import { removeObsoleteProviders } from './lib/services/providers/providerCleanup.js';
import { seedDemo, warnOnDefaultAdminPassword } from './lib/services/demo/demoService.js';
import { initDemoCleanupCron } from './lib/services/crons/demo-cleanup-cron.js';
import { initSessionCleanupCron } from './lib/services/crons/session-cleanup-cron.js';
import { initListingRetentionCron } from './lib/services/crons/listing-retention-cron.js';
import { initPriceTrackingCron } from './lib/services/crons/price-tracking-cron.js';
import { initTravelTimeCron } from './lib/services/crons/travel-time-cron.js';
import { initConnectivityCron } from './lib/services/crons/connectivity-cron.js';

// Ensure the CloakBrowser stealth Chromium binary is present and complete before
// jobs run.  ensureValidBinary() also detects and auto-heals partial extractions
// (e.g. a newer version that was downloaded but only the chrome executable was
// written) so Chrome never crashes with "Invalid file descriptor to ICU data".
logger.info('Checking CloakBrowser binary...');
await ensureValidBinary();
logger.info('CloakBrowser binary ready.');

// Configuration is loaded before Firestore and the services that consume it.
if (!(await checkIfConfigIsAccessible())) {
  logger.error('Configuration exists, but is not accessible. Please check the file permission');
  process.exit(1);
}

try {
  await refreshConfig();
} catch (error) {
  logger.error(error.message, error.cause ?? error);
  process.exit(1);
}

await FirestoreConnection.init();
logger.info('Storage: Firestore');

const settings = await getSettings();

// Restore the persisted on/off flag for opt-in DB log capture so it survives a
// Fredy restart. reloadEnabledFromSettings() also (un)wires the logger sink based
// on the restored flag, so the logger hot path stays cost-free when nobody enabled
// the feature.
await reloadEnabledFromSettings();

// Load provider modules once at startup
const providers = await getProviders();

// A provider that was deleted from lib/provider still lives on in the DB (in the provider config
// of existing jobs and in the listings it found). Those leftovers can never be scraped or
// re-checked again, so they are pruned before anything starts working with jobs or listings.
removeObsoleteProviders(providers);

await similarityCache.initSimilarityCache();
similarityCache.startSimilarityCacheReloader();

//assuming interval is always in minutes
const INTERVAL = settings.interval * 60 * 1000;

// Wire the Job Execution Service (sets the trigger runner + bus listeners) BEFORE the API starts
// listening. On scale-to-zero Cloud Run the external scheduler's wake-up request can hit
// /api/trigger the instant the server accepts connections; when this ran AFTER listen, that request
// raced the trigger runner and returned 500 "Job execution service not initialized", skipping the
// scrape for that cycle — which was the majority of cold-start cycles.
initJobExecutionService({ providers, intervalMs: INTERVAL });

// Initialize API only after migrations completed
await import('./lib/api/api.js');

if (settings.demoMode) {
  logger.info('Running in demo mode');
}

if (isFirebaseAuth()) {
  // Multi-tenant Firebase auth: the instance admin is whichever allowlist entry carries isAdmin: true.
  logger.info(`Auth mode: ${AUTH_MODE}`);
} else {
  await ensureAdminUserExists();
}
await ensureDemoUserExists();

// A demo instance must always present a working Fredy: the demo job is created on the first
// start and repaired on every later one, so a drifted config can never leave the demo empty.
await seedDemo(providers);
await warnOnDefaultAdminPassword();

await initTrackerCron();
//do not wait for this to finish, let it run in the background
initActiveCheckerCron();
initGeocodingCron();
await initDemoCleanupCron();
await initSessionCleanupCron();
await initListingRetentionCron();
// Schedules only. Unlike the others this one is never run on start: it renders a browser page per
// listing, and a restart is the worst moment to begin doing that.
initPriceTrackingCron();
// Same reasoning: schedule only. The sweep talks to a community routing service, and hammering it
// every time an instance restarts is exactly the behaviour their usage policy asks projects to avoid.
initTravelTimeCron();
// This one does run on start, unlike the two above: it costs two small JSON requests per address
// and nothing at all for an address sharing a cell with one already looked up, so a restart is not
// a moment it needs holding back from.
initConnectivityCron();

// Same resolution chain as api.js — PORT env (Cloud Run) wins, then config, then default.
logger.info(
  `Started Fredy successfully. Ui can be accessed via http://localhost:${Number(process.env.PORT) || settings.port || 9998}`,
);
