/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { checkIfConfigIsAccessible, getProviders, refreshConfig } from './lib/utils.js';
import * as similarityCache from './lib/services/similarity-check/similarityCache.js';
import logger from './lib/services/logger.js';
import { getSettings } from './lib/services/storage/settingsStorage.js';
import FirestoreConnection from './lib/services/storage/firestore/FirestoreConnection.js';
import { initJobExecutionService } from './lib/services/jobs/jobExecutionService.js';
import { removeObsoleteProviders } from './lib/services/providers/providerCleanup.js';

function validateProductionAuthConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const rawConfig = process.env.FIREBASE_WEB_CONFIG;
  if (!rawConfig) {
    throw new Error('FIREBASE_WEB_CONFIG is required in production');
  }

  let config;
  try {
    config = JSON.parse(rawConfig);
  } catch {
    throw new Error('FIREBASE_WEB_CONFIG must contain valid JSON');
  }

  if (
    config == null ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    typeof config.projectId !== 'string' ||
    typeof config.appId !== 'string' ||
    typeof config.apiKey !== 'string'
  ) {
    throw new Error('FIREBASE_WEB_CONFIG must contain projectId, appId, and apiKey');
  }

  if (!process.env.FRONTEND_ORIGIN) {
    throw new Error('FRONTEND_ORIGIN is required in production');
  }

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not allowed in production');
  }
}

validateProductionAuthConfiguration();

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

// Load provider modules once at startup
const providers = await getProviders();

// A provider that was deleted from lib/provider still lives on in the DB (in the provider config
// of existing jobs and in the listings it found). Those leftovers can never be scraped or
// re-checked again, so they are pruned before anything starts working with jobs or listings.
removeObsoleteProviders(providers);

await similarityCache.initSimilarityCache();
similarityCache.startSimilarityCacheReloader();

// Wire the Job Execution Service (sets the trigger runner + bus listeners) BEFORE the API starts
// listening. On scale-to-zero Cloud Run the external scheduler's wake-up request can hit
// /api/trigger the instant the server accepts connections; when this ran AFTER listen, that request
// raced the trigger runner and returned 500 "Job execution service not initialized", skipping the
// scrape for that cycle — which was the majority of cold-start cycles.
initJobExecutionService({ providers });

// Initialize API only after migrations completed
await import('./lib/api/api.js');

logger.info('Authentication: Firebase bearer tokens');

// No in-process schedulers: every scrape and maintenance sweep is driven by POST /api/trigger
// (see lib/services/maintenance/maintenanceSweeps.js for why).

// Same resolution chain as api.js — PORT env (Cloud Run) wins, then config, then default.
logger.info(
  `Started Fredy successfully. Ui can be accessed via http://localhost:${Number(process.env.PORT) || settings.port || 9998}`,
);
