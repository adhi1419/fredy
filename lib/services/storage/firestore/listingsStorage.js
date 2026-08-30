/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsStorage — Firestore implementation (facade).
 *
 * The implementation is split across four files so they can be developed and
 * reviewed independently; this module is the single import surface, mirroring
 * the sqlite lib/services/storage/listingsStorage.js exports 1:1.
 */

export { storeListings, getKnownListingHashesForJobAndProvider, getAllEntriesFromListings } from './listingsShared.js';
export * from './listingsCore.impl.js';
export * from './listingsLifecycle.impl.js';
export * from './listingsGeoKpi.impl.js';
