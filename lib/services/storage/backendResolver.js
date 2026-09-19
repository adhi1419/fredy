/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Storage backend selection.
 *
 * Resolution order:
 *   1. STORAGE_BACKEND env var ('sqlite' | 'firestore')
 *   2. `storage` key in conf/config.json
 *   3. default: 'sqlite'
 *
 * Resolved once at module load (top-level await); the process must restart to
 * switch backends, which matches how every storage module holds singletons.
 */

import { readConfigFromStorage } from '../../utils.js';

const VALID = new Set(['sqlite', 'firestore']);

async function resolve() {
  const fromEnv = process.env.STORAGE_BACKEND;
  if (fromEnv && VALID.has(fromEnv)) return fromEnv;
  try {
    const config = await readConfigFromStorage();
    if (config?.storage && VALID.has(config.storage)) return config.storage;
  } catch {
    // No config yet (fresh container) — default applies.
  }
  return 'sqlite';
}

export const STORAGE_BACKEND = await resolve();
export const isFirestore = () => STORAGE_BACKEND === 'firestore';
