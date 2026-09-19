/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * listingsStorage — Firestore implementation (facade).
 *
 * The implementation is split across four files for focused development and
 * review; this module remains the single public import surface.
 */

export { storeListings, getKnownListingHashesForJobAndProvider, getAllEntriesFromListings } from './listingsShared.js';
export * from './listingsCore.impl.js';
export * from './listingsLifecycle.impl.js';
export * from './listingsGeoKpi.impl.js';
