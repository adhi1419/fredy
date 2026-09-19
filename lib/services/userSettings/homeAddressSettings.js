/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import * as geocodingCron from '../crons/geocoding-cron.js';
import * as distance from '../geocoding/distanceService.js';
import * as geocoding from '../geocoding/geoCodingService.js';
import logger from '../logger.js';
import { DEFAULT_COUNTRIES } from '../providers/countries.js';
import * as providerCountries from '../providers/providerCountries.js';
import * as settingsStorage from '../storage/settingsStorage.js';

/** A request body that does not describe a valid home-address list. */
export class HomeAddressValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'HomeAddressValidationError';
  }
}

/**
 * @param {unknown} departure
 * @returns {{time: string}|null}
 */
function normalizeDeparture(departure) {
  if (departure == null || typeof departure !== 'object') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(departure.time ?? '').trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return { time: `${String(Number(match[1])).padStart(2, '0')}:${match[2]}` };
}

/**
 * @param {unknown} mode
 * @returns {'transit'|'car'|'bike'|'walk'}
 */
function normalizeMode(mode) {
  const value = String(mode ?? '').toLowerCase();
  return ['car', 'bike', 'walk'].includes(value) ? value : 'transit';
}

/**
 * @param {Array<import('../../types/listing.js').Address>} addresses
 * @returns {string}
 */
function routingSignature(addresses) {
  return JSON.stringify(
    (addresses ?? []).map((address) => [
      address?.label,
      address?.coords?.lat,
      address?.coords?.lng,
      address?.mode,
      address?.departure?.time ?? null,
    ]),
  );
}

/**
 * @param {unknown} providers
 * @returns {string[]}
 */
function providerIds(providers) {
  return typeof providers === 'string'
    ? providers
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : [];
}

/**
 * @param {() => Promise<string[]>} resolve
 * @returns {Promise<string[]>}
 */
async function resolveCountries(resolve) {
  try {
    return await resolve();
  } catch (error) {
    logger.error('Could not resolve the countries for an address lookup, falling back to the default', error);
    return [...DEFAULT_COUNTRIES];
  }
}

/**
 * @typedef {Object} HomeAddressSettingsDependencies
 * @property {Function} [getAddresses]
 * @property {Function} [getUserSettings]
 * @property {Function} [upsertSettings]
 * @property {Function} [geocodeAddress]
 * @property {Function} [getCountriesForProviderIds]
 * @property {Function} [getCountriesForUser]
 * @property {Function} [updateDistancesForAddressChange]
 * @property {Function} [runGeoCordTask]
 */

/**
 * Create the home-address settings module. Its two operations own address normalization, country
 * scope, geocoding, persistence, routing-signature invalidation, and retry-sweep ordering.
 * Dependencies resolve inside the operation that uses them so isolated route mocks need only expose
 * the behavior their route executes.
 *
 * @param {HomeAddressSettingsDependencies} [dependencies]
 * @returns {{getCountriesForLookup: (params: {userId: string, providers?: unknown}) => Promise<string[]>, saveHomeAddresses: (params: {userId: string, homeAddresses?: unknown}) => Promise<Array<Object>>}}
 */
export function createHomeAddressSettings(dependencies = {}) {
  async function getCountriesForLookup({ userId, providers }) {
    const getCountriesForProviderIds =
      dependencies.getCountriesForProviderIds ?? providerCountries.getCountriesForProviderIds;
    const getCountriesForUser = dependencies.getCountriesForUser ?? providerCountries.getCountriesForUser;
    const ids = providerIds(providers);
    return ids.length > 0
      ? resolveCountries(() => getCountriesForProviderIds(ids))
      : resolveCountries(() => getCountriesForUser(userId));
  }

  async function saveHomeAddresses({ userId, homeAddresses }) {
    if (homeAddresses != null && !Array.isArray(homeAddresses)) {
      throw new HomeAddressValidationError('home_addresses must be an array.');
    }

    const getAddresses = dependencies.getAddresses ?? settingsStorage.getAddresses;
    const getUserSettings = dependencies.getUserSettings ?? settingsStorage.getUserSettings;
    const upsertSettings = dependencies.upsertSettings ?? settingsStorage.upsertSettings;
    const geocodeAddress = dependencies.geocodeAddress ?? geocoding.geocodeAddress;
    const getCountriesForUser = dependencies.getCountriesForUser ?? providerCountries.getCountriesForUser;
    const updateDistancesForAddressChange =
      dependencies.updateDistancesForAddressChange ?? distance.updateDistancesForAddressChange;
    const runGeoCordTask = dependencies.runGeoCordTask ?? geocodingCron.runGeoCordTask;

    const previousSignature = routingSignature(getAddresses(await getUserSettings(userId)));
    const entries = (homeAddresses || []).filter((address) => address && address.address);
    const labels = entries.map((address) =>
      String(address.label || address.address)
        .trim()
        .toLowerCase(),
    );
    if (new Set(labels).size !== labels.length) {
      throw new HomeAddressValidationError('Each address needs its own name.');
    }

    if (entries.length === 0) {
      await upsertSettings({ home_addresses: null }, userId);
      if (previousSignature !== routingSignature([])) {
        updateDistancesForAddressChange(userId, []);
      }
      return [];
    }

    const homeCountries = await resolveCountries(() => getCountriesForUser(userId));
    const geocoded = [];
    for (const { label, address, departure, mode } of entries) {
      const coords = (await geocodeAddress(address, homeCountries)) || { lat: -1, lng: -1 };
      const entry = { label: label || address, address, coords, mode: normalizeMode(mode) };
      const normalizedDeparture = normalizeDeparture(departure);
      if (normalizedDeparture != null) entry.departure = normalizedDeparture;
      geocoded.push(entry);
    }

    await upsertSettings({ home_addresses: geocoded }, userId);
    if (previousSignature !== routingSignature(geocoded)) {
      updateDistancesForAddressChange(userId, geocoded);
    }
    runGeoCordTask();
    return geocoded;
  }

  return { getCountriesForLookup, saveHomeAddresses };
}

const defaultSettings = createHomeAddressSettings();
export const { getCountriesForLookup, saveHomeAddresses } = defaultSettings;
