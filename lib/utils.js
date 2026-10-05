/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { dirname } from 'node:path';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { DEFAULT_CONFIG } from './defaultConfig.js';
import fs, { readFileSync } from 'fs';
import logger from './services/logger.js';
import { normalizeProviderMetaInformation } from './services/providers/capabilities.js';
import { packageUp } from 'package-up';

const RE_GT = />/g;
const RE_WEBP = /\/format\/webp/gi;
const RE_EXT = /\.(jpe?g|png|gif)(\?.*)?$/i;
const HTTPS_PREFIX = 'https://';
const providersDirectoryPath = `${getDirName()}/provider`;

/**
 * Lazily load all provider modules from the provider directory.
 * Caches the resolved array to avoid re-importing on subsequent calls.
 *
 * @returns {Promise<any[]>} A list of loaded provider modules.
 */
let cachedProvidersPromise = null;

export function getProviders() {
  if (!cachedProvidersPromise) {
    cachedProvidersPromise = loadPluginModules(providersDirectoryPath).then((providers) =>
      providers.map((provider) => ({
        ...provider,
        metaInformation: normalizeProviderMetaInformation(provider.metaInformation),
      })),
    );
  }
  return cachedProvidersPromise;
}

/** @type {Promise<any[]>|null} */
let cachedAdaptersPromise = null;

/**
 * Lazily load all notification adapter modules, caching the result.
 *
 * @returns {Promise<any[]>}
 */
export function getNotificationAdapters() {
  if (!cachedAdaptersPromise) {
    cachedAdaptersPromise = loadPluginModules(path.join(getDirName(), 'notification', 'adapter'));
  }
  return cachedAdaptersPromise;
}

/**
 * Import every `.js` module in a directory, in a stable order.
 *
 * Resolves against this module's own location rather than `process.cwd()`. Three call sites used
 * to spell the directory out as a CWD-relative string (`'./lib/provider'`, `'./lib//notification/
 * adapter'`), so starting Fredy from anywhere but the repository root crashed at import time,
 * before a single route was registered.
 *
 * @param {string} directory - Absolute path of the plugin directory.
 * @returns {Promise<any[]>} The loaded modules.
 */
export function loadPluginModules(directory) {
  const fileNames = fs
    .readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.js'))
    .sort();
  return Promise.all(fileNames.map((fileName) => import(pathToFileURL(path.join(directory, fileName)).href)));
}

/**
 * Safely stringify a value to JSON for storage.
 * - Returns null when the input is null or undefined.
 * - Uses JSON.stringify directly otherwise.
 *
 * @template T
 * @param {T} v - Any JSON-serializable value.
 * @returns {string|null} JSON string or null.
 */
const toJson = (v) => (v == null ? null : JSON.stringify(v));

/**
 * Safely parse JSON text coming from storage.
 * - Returns the provided fallback when input is null/undefined.
 * - Returns the fallback when parsing fails.
 *
 * @template T
 * @param {string|null|undefined} txt - JSON text from DB/storage.
 * @param {T} fallback - Value to return when txt is null/invalid.
 * @returns {T} Parsed value or fallback.
 */
const fromJson = (txt, fallback) => {
  if (txt == null) return fallback;
  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
};

/**
 * Determine if the current process runs in development mode.
 * Returns true when NODE_ENV is not 'production'.
 * @returns {boolean}
 */
function inDevMode() {
  return process.env.NODE_ENV == null || process.env.NODE_ENV !== 'production';
}

/**
 * Check if a word contains any of the strings in the given array (case-insensitive, substring match).
 * @param {string} word
 * @param {string[]} arr
 * @returns {boolean}
 */
function isOneOf(word, arr) {
  if (!arr || arr.length === 0 || word == null) return false;
  const lowerWord = word.toLowerCase();
  return arr.some((item) => lowerWord.indexOf(item.toLowerCase()) !== -1);
}

/**
 * Check if a value is null or an empty string/array.
 * @param {any} val
 * @returns {boolean}
 */
function nullOrEmpty(val) {
  return val == null || val.length === 0;
}

/**
 * Return the directory name of the current module (ESM equivalent of __dirname).
 * @returns {string}
 */
function getDirName() {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Build a sha256 hash string from the provided inputs (ignores null/empty strings).
 * Returns null if there are no valid inputs.
 * @param {...(string|null|undefined)} inputs
 * @returns {string|null}
 */
function buildHash(...inputs) {
  if (inputs == null) {
    return null;
  }
  const cleaned = inputs.filter((i) => i != null && i.length > 0);
  if (cleaned.length === 0) {
    return null;
  }
  return createHash('sha256').update(cleaned.join(',')).digest('hex');
}

/**
 * Run `worker` over `items` with at most `limit` in flight at a time.
 *
 * Both listing sweeps hit external hosts in parallel and both have to stay well below "as fast as
 * the event loop allows", so the cap is the point of the helper rather than an afterthought. A
 * worker that throws does not abort the run - its rejection is stored in the corresponding slot, so
 * one unreachable listing cannot cost the caller every other result it already paid for.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit Maximum concurrent workers.
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<R[]>} Results in input order; a failed slot holds the error.
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runOne() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = /** @type {any} */ (err);
      }
    }
  }

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runOne);
  await Promise.all(runners);
  return results;
}

/**
 * If the config exists, but cannot be accessed, we quit Fredy as something is fishy here.
 * @returns {Promise<boolean>}
 */
export async function checkIfConfigIsAccessible() {
  const configPath = configFilePath();
  try {
    if (!fs.existsSync(configPath)) {
      return true;
    }
    fs.accessSync(configPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read config JSON from disk (conf/config.json) and parse it.
 * @param {string} [targetPath] - Config file to read. Injectable so tests do not touch the real one.
 * @returns {Promise<any>} Parsed configuration object.
 */
export async function readConfigFromStorage(targetPath = configFilePath()) {
  return JSON.parse(await readFile(targetPath, 'utf8'));
}

/**
 * Absolute path of the single runtime config file.
 *
 * The location used to be spelled out three different ways (`new URL('../conf/config.json',
 * import.meta.url)` in one place, string concatenation on `getDirName()` in two others), so a
 * change to the layout had three chances to be missed.
 *
 * @returns {string}
 */
export function configFilePath() {
  return path.join(getDirName(), '..', 'conf', 'config.json');
}

/**
 * Ensure conf/config.json exists and is complete, creating or repairing it as needed.
 *
 * Called once from the entrypoint, before anything reads the config. It used to also keep a
 * module-level copy of the parsed config, but nothing ever read that copy - every consumer goes
 * through `readConfigFromStorage()` or the settings cache - so the copy was pure drift risk.
 *
 * @param {string} [targetPath] - Config file to use. Injectable so tests do not touch the real one.
 * @returns {Promise<Record<string, any>>} The config as it now stands on disk.
 * @throws {Error} When the file exists but cannot be read, parsed, or is not a JSON object.
 */
export async function refreshConfig(targetPath = configFilePath()) {
  checkIfConfigExistsAndWriteIfNot(targetPath);

  let stored;
  try {
    stored = await readConfigFromStorage(targetPath);
  } catch (error) {
    // An unreadable operator-supplied config must never be silently overwritten.
    throw new Error(
      `The configuration at ${targetPath} exists but could not be read or parsed. Fix or delete the file; Fredy recreates an empty config when it is absent.`,
      { cause: error },
    );
  }

  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error(
      `The configuration at ${targetPath} is not a JSON object. Refusing to start rather than replacing it.`,
    );
  }

  return stored;
}

/**
 * If the config file does not exist, create it with DEFAULT_CONFIG.
 * @param {string} [configPath] - Config file to create. Injectable so tests do not touch the real one.
 * @returns {void}
 */
const checkIfConfigExistsAndWriteIfNot = (configPath = configFilePath()) => {
  if (fs.existsSync(configPath)) return;

  logger.info('Could not find config file. Will create one with default values now');
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ ...DEFAULT_CONFIG }, null, 2));
  } catch (error) {
    // Named explicitly because the bare errno is unhelpful here: in a container this path is a
    // mounted volume, and "EACCES" alone does not tell the operator that the mount is what needs
    // fixing.
    throw new Error(`No configuration at ${configPath}, and it could not be created.`, { cause: error });
  }
};

/**
 * Normalize image URLs:
 * - Trim, remove stray '>' characters.
 * - Convert '/format/webp' segments to '/format/jpg'.
 * - Enforce HTTPS and ensure a valid image extension (jpg/png/gif). If URL contains '.jpg' without query, cut trailing parts.
 * - Return null for invalid inputs.
 * @param {string} url
 * @returns {string|null}
 */
const normalizeImageUrl = (url) => {
  if (typeof url !== 'string' || url.length === 0) return null;

  let u = url.trim().replace(RE_GT, '');
  if (RE_WEBP.test(u)) u = u.replace(RE_WEBP, '/format/jpg');
  if (!u.startsWith(HTTPS_PREFIX)) return null;
  if (!RE_EXT.test(u)) {
    const jpgIdx = u.toLowerCase().lastIndexOf('.jpg');
    if (jpgIdx > -1) u = u.slice(0, jpgIdx + 4);
  }
  return u;
};

/**
 * returns Fredy's version
 * @returns {Promise<*|string>}
 */
async function getPackageVersion() {
  try {
    const packagePath = await packageUp();
    const packageJson = readFileSync(packagePath, 'utf8');
    const json = JSON.parse(packageJson);
    return json.version;
  } catch (error) {
    logger.error('Error reading version from package.json', error);
  }
  return 'N/A';
}

/**
 * Sleep helper
 * @param {number} ms milliseconds to wait
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return a random integer between min and max (inclusive).
 * @param {number} min - Minimum integer value.
 * @param {number} max - Maximum integer value.
 * @returns {number} A random integer N where min <= N <= max.
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// The config is populated by index.js during startup. It used to also be refreshed by a top-level
// await here, which ran on every import of this module and duplicated the entrypoint's own call.

export {
  isOneOf,
  normalizeImageUrl,
  inDevMode,
  nullOrEmpty,
  getDirName,
  sleep,
  randomBetween,
  mapLimit,
  buildHash,
  getPackageVersion,
  toJson,
  fromJson,
};
