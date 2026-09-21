/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export type MobileListingAction = 'apply' | 'maps' | 'provider';

interface ListingActionRecord {
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  lifecycle?: { state?: string } | null;
  inquiry_send_status?: string;
  inquiry_message?: unknown;
}

/**
 * The frozen order of the one-handed mobile listing action row.
 *
 * @type {readonly ['apply', 'maps', 'provider']}
 */
export const MOBILE_LISTING_ACTION_ORDER = Object.freeze(['apply', 'maps', 'provider'] as const);

/**
 * Translation keys used by the icon-only mobile actions. Keeping the labels beside the order
 * prevents a visual reorder from silently breaking the accessible names.
 */
export const MOBILE_LISTING_ACTION_LABELS: Readonly<Record<MobileListingAction, string>> = Object.freeze({
  apply: 'listing.detail.mobile.apply',
  maps: 'listing.detail.mobile.openMaps',
  provider: 'listing.detail.mobile.openProvider',
});

/**
 * Canonical API actions behind the visible listing controls.
 *
 * The reverse of `archive` is the backend `restore` action (the `/:listingId/status` route accepts
 * it and `transitionLifecycle` maps `restore` back to the `new` state). It is passed as a literal
 * at the call site rather than added here, so this frozen map keeps naming only the four controls.
 */
export const LISTING_LIFECYCLE_ACTIONS = Object.freeze({
  appliedSelf: 'applied',
  viewing: 'viewing',
  archive: 'archive',
});

/** The one persisted lifecycle state, read as a view rather than kept as separate booleans. */
export type ListingLifecycle = 'new' | 'applied' | 'viewed' | 'archived';

/**
 * Resolve the single lifecycle state a listing is in, folding provider-confirmed delivery into
 * `applied` so the detail page, the card symbol and the Home filter cannot drift apart.
 *
 * @param {{lifecycle?: {state?: string}, inquiry_send_status?: string}|null|undefined} listing
 * @returns {ListingLifecycle}
 */
export function getListingLifecycle(listing: ListingActionRecord | null | undefined): ListingLifecycle {
  const stored = listing?.lifecycle?.state;
  if (stored === 'applied' || stored === 'viewed' || stored === 'archived') return stored;
  return isListingApplied(listing) ? 'applied' : 'new';
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Return a navigable HTTP(S) URL, or null for untrusted/malformed values.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function getSafeExternalUrl(value: unknown): string | null {
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
export function getGoogleMapsUrl(listing: ListingActionRecord | null | undefined): string | null {
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
export function isListingApplied(listing: ListingActionRecord | null | undefined): boolean {
  return listing?.lifecycle?.state === 'applied' || listing?.inquiry_send_status === 'sent';
}

/**
 * Read the submitted message persisted with a confirmed application.
 *
 * @param {{inquiry_message?: unknown}|null|undefined} listing
 * @returns {string|null}
 */
export function getAppliedMessage(listing: ListingActionRecord | null | undefined): string | null {
  const message = typeof listing?.inquiry_message === 'string' ? listing.inquiry_message.trim() : '';
  return message || null;
}
