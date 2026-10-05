/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import logger from '../../services/logger.js';
import { getPublicSettings, upsertSettings } from '../../services/storage/settingsStorage.js';
import { isAdmin } from '../security.js';
import { normalizeSourceSwitches } from '../../services/connectivity/connectivityService.js';

/**
 * Settings a non-admin is served.
 *
 * The route stays open to every logged-in user because the app needs it during boot - `interval`
 * is shown on the dashboard. Everything else on this endpoint is operator
 * configuration (port, session lifetime) that a regular user has
 * no use for, so the payload is narrowed by role rather than the route being closed off.
 *
 * `connectivityEnabled` decides whether a whole
 * section of the listings UI exists. Without it every user would be shown broadband filters that
 * their operator has switched off, and they would silently match nothing.
 * @type {string[]}
 */
const NON_ADMIN_SETTINGS = ['interval', 'connectivityEnabled'];

/**
 * Bounds for the connectivity sweep settings.
 *
 * The registers behind the feature are public services, so the ceiling on the batch size is there
 * to keep a mistyped value from turning a nightly sweep into a burst somebody has to block. The
 * age is bounded at the bottom because the data underneath only moves twice a year - re-asking
 * daily would be pure traffic for an answer that cannot have changed.
 * @type {Record<string, {min: number, max: number, integer: boolean}>}
 */
const CONNECTIVITY_SETTING_BOUNDS = {
  connectivityLimitPerRun: { min: 1, max: 1000, integer: true },
  connectivityMaxAgeDays: { min: 7, max: 730, integer: true },
};

/**
 * Validate one numeric connectivity setting.
 *
 * @param {string} name The setting name, used in the message.
 * @param {any} value The raw value from the request body.
 * @returns {string|null} An error message, or null when the value is acceptable.
 */
function validateConnectivitySetting(name, value) {
  const bounds = CONNECTIVITY_SETTING_BOUNDS[name];
  if (value === '' || value === null) {
    return `${name} must be a number.`;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return `${name} must be an integer between ${bounds.min} and ${bounds.max}.`;
  }
  return null;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function generalSettingsPlugin(fastify) {
  fastify.get('/', async (request) => {
    // getPublicSettings() drops secrets for everyone, admins included - nothing in the UI reads
    // them, and they must not travel to a browser.
    const settings = await getPublicSettings();
    if (isAdmin(request)) {
      return settings;
    }
    return Object.fromEntries(NON_ADMIN_SETTINGS.map((name) => [name, settings[name]]));
  });

  fastify.post('/', async (request, reply) => {
    const appSettings = { ...(request.body || {}) };
    if (typeof appSettings.baseUrl === 'string') {
      appSettings.baseUrl = appSettings.baseUrl.trim().replace(/\/$/, '');
    }

    if (!isAdmin(request)) {
      return reply.code(403).send({ error: 'Only admins can change these settings.' });
    }

    for (const name of Object.keys(CONNECTIVITY_SETTING_BOUNDS)) {
      if (typeof appSettings[name] === 'undefined') continue;
      const error = validateConnectivitySetting(name, appSettings[name]);
      if (error != null) {
        return reply.code(400).send({ error });
      }
      appSettings[name] = Number(appSettings[name]);
    }

    if (typeof appSettings.connectivityEnabled !== 'undefined') {
      appSettings.connectivityEnabled = appSettings.connectivityEnabled === true;
    }

    // Normalised rather than validated: the switches are a map keyed by source id, and a request
    // carrying an id no source claims should lose that key rather than be rejected - an instance
    // downgrading to a release with fewer sources would otherwise be unable to save this page.
    if (typeof appSettings.connectivitySources !== 'undefined') {
      appSettings.connectivitySources = normalizeSourceSwitches(appSettings.connectivitySources);
    }

    try {
      await upsertSettings(appSettings);
    } catch (err) {
      logger.error(err);
      return reply.code(500).send({ error: 'Error while trying to write settings.' });
    }
    return reply.send();
  });
}
