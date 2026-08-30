/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * settingsStorage — Firestore implementation.
 *
 * Same public API and semantics as the SQLite implementation; only the calls
 * that were synchronous there are async here. All consumers must await
 * (see contract suite).
 *
 * Data model: collection `settings`, one document per (scope, name):
 *   doc id  : `${scope}__${encodeURIComponent(name)}`  (scope = userId or '__global__')
 *   fields  : { name, userId (null for global), value (JSON string), createDate }
 *
 * The value is stored as a JSON string (not a native map) to preserve the
 * SQLite implementation's exact round-trip semantics for every JS type.
 */

import { nanoid } from 'nanoid';
import FirestoreConnection from './FirestoreConnection.js';
import { fromJson, readConfigFromStorage, toJson } from '../../../utils.js';

const COLLECTION = 'settings';
const GLOBAL_SCOPE = '__global__';

/** @type {Record<string, any>|null} */
let cachedSettingsConfig = null;

function docId(name, userId) {
  return `${userId ?? GLOBAL_SCOPE}__${encodeURIComponent(name)}`;
}

/**
 * Build a config object from stored rows (same unwrap semantics as sqlite impl).
 */
function compileSettings(rows, configValues) {
  const config = {};
  for (const r of rows) {
    const parsed = fromJson(r.value, null);
    config[r.name] = parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : parsed;
  }
  return { ...configValues, ...config };
}

async function fetchScope(userId) {
  const snapshot = await FirestoreConnection.collection(COLLECTION)
    .where('userId', '==', userId ?? null)
    .get();
  return snapshot.docs.map((d) => d.data());
}

export async function refreshSettingsCache() {
  const rows = await fetchScope(null);
  const configValues = await readConfigFromStorage();
  cachedSettingsConfig = compileSettings(rows, configValues);
  return cachedSettingsConfig;
}

/**
 * User-specific settings. Async here (sync in the sqlite impl) — callers await.
 * @param {string} userId
 */
export async function getUserSettings(userId) {
  if (!userId || typeof userId !== 'string') {
    return {};
  }
  const rows = await fetchScope(userId);
  return compileSettings(rows, {});
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

export async function getOrCreateSessionSecret() {
  const settings = await getSettings();
  if (settings.session_secret) return settings.session_secret;
  const secret = nanoid(64);
  await upsertSettings({ session_secret: secret });
  return secret;
}

/**
 * Upsert (or delete-on-null) one or more settings. Same input shapes as the
 * sqlite implementation: object map, {name, value} entry, or entries array.
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
