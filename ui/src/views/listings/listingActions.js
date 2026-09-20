/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The frozen order of the one-handed mobile listing action row.
 *
 * @type {readonly ['apply', 'maps', 'provider']}
 */
export const MOBILE_LISTING_ACTION_ORDER = Object.freeze(['apply', 'maps', 'provider']);

/**
 * Translation keys used by the icon-only mobile actions. Keeping the labels beside the order
 * prevents a visual reorder from silently breaking the accessible names.
 */
export const MOBILE_LISTING_ACTION_LABELS = Object.freeze({
  apply: 'listing.detail.mobile.apply',
  maps: 'listing.detail.mobile.openMaps',
  provider: 'listing.detail.mobile.openProvider',
});

/** Canonical API actions behind the four visible listing controls. */
export const LISTING_LIFECYCLE_ACTIONS = Object.freeze({
  appliedSelf: 'applied',
  viewing: 'viewing',
  archive: 'archive',
});

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Return a navigable HTTP(S) URL, or null for untrusted/malformed values.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function getSafeExternalUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    return SAFE_EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Build the Google Maps search URL for a listing when it has a usable address or coordinate pair.
 * Address is preferred because it remains useful when a portal's coordinates are absent or stale.
 *
 * @param {{address?: unknown, latitude?: unknown, longitude?: unknown}|null|undefined} listing
 * @returns {string|null}
 */
export function getGoogleMapsUrl(listing) {
  const address = typeof listing?.address === 'string' ? listing.address.trim() : '';
  const latitude = Number(listing?.latitude);
  const longitude = Number(listing?.longitude);
  const coordinatesPresent = listing?.latitude != null && listing?.longitude != null;
  const hasCoordinates =
    coordinatesPresent &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude !== -1 &&
    longitude !== -1;
  const query = address || (hasCoordinates ? `${latitude},${longitude}` : '');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

/**
 * Whether the canonical lifecycle response says the listing is applied.
 * Provider-confirmed delivery and a manual action both use this same lifecycle state.
 *
 * @param {{lifecycle?: {state?: string}, inquiry_send_status?: string}|null|undefined} listing
 * @returns {boolean}
 */
export function isListingApplied(listing) {
  return listing?.lifecycle?.state === 'applied' || listing?.inquiry_send_status === 'sent';
}

/**
 * Read the submitted message persisted with a confirmed application.
 *
 * @param {{inquiry_message?: unknown}|null|undefined} listing
 * @returns {string|null}
 */
export function getAppliedMessage(listing) {
  const message = typeof listing?.inquiry_message === 'string' ? listing.inquiry_message.trim() : '';
  return message || null;
}
