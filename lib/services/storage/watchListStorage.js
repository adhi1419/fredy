/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * AUTO-GENERATED backend-selecting facade — do not edit by hand.
 * Regenerate with: node tools/generate-storage-facades.mjs
 *
 * Re-exports the watchListStorage implementation for the
 * backend chosen by backendResolver (sqlite | firestore). Consumers keep
 * importing this path; the decision happens once at module load.
 */
import { isFirestore } from './backendResolver.js';

const impl = isFirestore()
  ? await import('./firestore/watchListStorage.js')
  : await import('./sqlite/watchListStorage.js');

export const { createWatch, deleteWatch, ensureWatch, toggleWatch } = impl;
