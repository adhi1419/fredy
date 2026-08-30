/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Backend-selecting facade for MCP OAuth storage (see backendResolver.js).
 */
import { isFirestore } from '../services/storage/backendResolver.js';

const impl = isFirestore()
  ? await import('../services/storage/firestore/mcpOAuthStorage.js')
  : await import('./mcpOAuthStorage.sqlite.js');

export const {
  createClient,
  getClient,
  createAuthorizationCode,
  redeemAuthorizationCode,
  refreshAccessToken,
  validateAccessToken,
  listGrants,
  revokeGrant,
  sweepExpired,
} = impl;
