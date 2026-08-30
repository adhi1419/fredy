/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Backend-selecting facade for debug log storage (see backendResolver.js).
 */
import { isFirestore } from '../storage/backendResolver.js';

const impl = isFirestore()
  ? await import('../storage/firestore/debugLogStorage.js')
  : await import('./debugLogStorage.sqlite.js');

export const {
  MAX_DEBUG_LOG_BYTES,
  isEnabled,
  appendLogEntry,
  clearAllDebugLogs,
  getCurrentSize,
  getMaxSize,
  hasAnyLogs,
  wasEverEnabled,
  enableDebugLogging,
  disableDebugLogging,
  getAllDebugLogs,
  reloadEnabledFromSettings,
  _resetForTests,
} = impl;
