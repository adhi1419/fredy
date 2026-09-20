/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export const LISTING_LIFECYCLE_ACTIONS: {
  readonly appliedSelf: 'applied';
  readonly viewing: 'viewing';
  readonly archive: 'archive';
};
export const MOBILE_LISTING_ACTION_LABELS: Readonly<Record<'apply' | 'maps' | 'provider', string>>;
export const MOBILE_LISTING_ACTION_ORDER: readonly ('apply' | 'maps' | 'provider')[];
export function getAppliedMessage(listing: unknown): string | null;
export function getGoogleMapsUrl(listing: unknown): string | null;
export function getSafeExternalUrl(value: unknown): string | null;
export function isListingApplied(listing: unknown): boolean;
