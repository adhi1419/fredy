/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Auth mode selection.
 *
 * Resolution order:
 *   1. AUTH_MODE env var ('password' | 'firebase')
 *   2. `authMode` key in conf/config.json
 *   3. default: 'password'
 *
 * 'firebase' replaces the username/password login with a Google sign-in
 * exchange (see doc/prd-multi-tenant-auth.md). Everything after login —
 * sessions, authHook, SSE — is identical in both modes.
 */

import { readConfigFromStorage } from '../utils.js';

const VALID = new Set(['password', 'firebase']);

async function resolve() {
  const fromEnv = process.env.AUTH_MODE;
  if (fromEnv && VALID.has(fromEnv)) return fromEnv;
  try {
    const config = await readConfigFromStorage();
    if (config?.authMode && VALID.has(config.authMode)) return config.authMode;
  } catch {
    // No config yet — default applies.
  }
  return 'password';
}

export const AUTH_MODE = await resolve();
export const isFirebaseAuth = () => AUTH_MODE === 'firebase';
