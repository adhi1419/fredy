/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * AUTO-GENERATED backend-selecting facade — do not edit by hand.
 * Regenerate with: node tools/generate-storage-facades.mjs
 *
 * Re-exports the listingsStorage implementation for the
 * backend chosen by backendResolver (sqlite | firestore). Consumers keep
 * importing this path; the decision happens once at module load.
 */
import { isFirestore } from './backendResolver.js';

const impl = isFirestore()
  ? await import('./firestore/listingsStorage.js')
  : await import('./sqlite/listingsStorage.js');

export const {
  getKnownListingHashesForJobAndProvider,
  getListingsPerDayForJobIds,
  getListingsKpisForJobIds,
  getProviderDistributionForJobIds,
  getAvailableProviders,
  ACTIVE_CHECK_FAILURE_LIMIT,
  ACTIVE_CHECK_FAILURE_RETRY_MS,
  getListingsDueForActiveCheck,
  markListingsChecked,
  recordActiveCheckFailures,
  deactivateListings,
  reactivateListings,
  purgeExpiredInactiveListings,
  PRICE_CHECK_STALE_MS,
  getListingsDueForPriceCheck,
  markListingsPriceChecked,
  recordPriceObservation,
  applyPriceChange,
  getPriceHistory,
  storeListings,
  queryListings,
  deleteListingsByJobId,
  deleteInactiveListingsByJobId,
  deleteListingsById,
  restoreListingsById,
  getListingsToGeocode,
  getListingsToEnrichConnectivity,
  updateListingConnectivity,
  updateListingGeocoordinates,
  getListingsForMap,
  getAllEntriesFromListings,
  getGeocoordinatesByAddress,
  getListingsToCalculateDistance,
  getListingsForUserToCalculateDistance,
  updateListingDistances,
  TRAVEL_TIME_FAILURE_LIMIT,
  getListingsDueForTravelTimes,
  getTravelTimesForListings,
  attachTravelTimes,
  saveListingTravelTimes,
  recordTravelTimeFailure,
  markTravelTimesDirty,
  filterListingIdsForUser,
  userCanAccessListing,
  getListingById,
  setListingNotes,
  setInquiryMessage,
  setListingAddress,
  setListingStatus,
} = impl;
