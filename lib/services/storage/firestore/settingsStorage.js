/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * settingsStorage — Firestore implementation.
 *
 * All operations are asynchronous, and consumers must await them (see the
 * Firestore contract suite).
 *
 * Data model: collection `settings`, one document per (scope, name):
 *   doc id  : `${scope}__${encodeURIComponent(name)}`  (scope = userId or '__global__')
 *   fields  : { name, userId (null for global), value (JSON string), createDate }
 *
 * Values are stored as JSON strings rather than native maps so arrays,
 * objects, booleans and numbers round-trip through one stable representation.
 */

import { nanoid } from 'nanoid';
import FirestoreConnection from './FirestoreConnection.js';
import { fromJson, toJson } from '../../../utils.js';

const COLLECTION = 'settings';
const GLOBAL_SCOPE = '__global__';

/** Effective values for a new Firestore-backed installation. */
export const DEFAULT_APPLICATION_SETTINGS = Object.freeze({
  interval: 60,
  port: 9998,
  workingHours: { from: null, to: null },
  demoMode: false,
});

/** @type {Record<string, any>|null} */
let cachedSettingsConfig = null;

function docId(name, userId) {
  return `${userId ?? GLOBAL_SCOPE}__${encodeURIComponent(name)}`;
}

/**
 * Build a config object from stored setting documents.
 */
function compileSettings(rows) {
  const config = {};
  for (const r of rows) {
    const parsed = fromJson(r.value, null);
    config[r.name] = parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : parsed;
  }
  return config;
}

async function fetchScope(userId) {
  const snapshot = await FirestoreConnection.collection(COLLECTION)
    .where('userId', '==', userId ?? null)
    .get();
  return snapshot.docs.map((d) => d.data());
}

export async function refreshSettingsCache() {
  const rows = await fetchScope(null);
  cachedSettingsConfig = { ...DEFAULT_APPLICATION_SETTINGS, ...compileSettings(rows) };
  return cachedSettingsConfig;
}

/**
 * Read user-specific settings; callers must await the Firestore query.
 * @param {string} userId
 */
export async function getUserSettings(userId) {
  if (!userId || typeof userId !== 'string') {
    return {};
  }
  const rows = await fetchScope(userId);
  return compileSettings(rows);
}

/**
 * @param {Record<string, any>} settings
 */
export function getAddresses(settings) {
  return Array.isArray(settings?.home_addresses) ? settings.home_addresses : [];
}

export async function getSettings() {
  if (cachedSettingsConfig == null) {
    return refreshSettingsCache();
  }
  return cachedSettingsConfig;
}

const NON_SERIALIZABLE_SETTINGS = new Set(['session_secret', 'proxyAuthSecret']);

export async function getPublicSettings() {
  const all = await getSettings();
  return Object.fromEntries(Object.entries(all).filter(([name]) => !NON_SERIALIZABLE_SETTINGS.has(name)));
}

/**
 * Upsert (or delete-on-null) one or more settings. Accepts an object map,
 * a single {name, value} entry, or an entries array.
 */
export async function upsertSettings(settingsMapOrEntry, userId = null) {
  const entries = Array.isArray(settingsMapOrEntry)
    ? settingsMapOrEntry
    : typeof settingsMapOrEntry === 'object' &&
        settingsMapOrEntry != null &&
        'name' in settingsMapOrEntry &&
        'value' in settingsMapOrEntry
      ? [[settingsMapOrEntry.name, settingsMapOrEntry.value]]
      : Object.entries(settingsMapOrEntry || {});

  const col = FirestoreConnection.collection(COLLECTION);
  const batch = FirestoreConnection.getConnection().batch();
  for (const [name, rawValue] of entries) {
    const ref = col.doc(docId(name, userId));
    if (rawValue === null) {
      batch.delete(ref);
    } else {
      batch.set(ref, {
        id: nanoid(),
        create_date: Date.now(),
        name,
        value: toJson(rawValue),
        userId: userId ?? null,
      });
    }
  }
  await batch.commit();

  if (userId == null) {
    cachedSettingsConfig = null;
  }
}
