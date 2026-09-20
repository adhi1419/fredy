/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** Whether a job searches for something to rent or something to buy. */
export type DealType = 'rent' | 'buy';

export const DEAL_TYPES = Object.freeze({ RENT: 'rent', BUY: 'buy' } as const);

/** Word starts that mark a rental search on the German portals Fredy supports. */
const RENT_PATTERN = /(^|[^a-z])(miet|rent)/;

/** The same for a purchase search. */
const BUY_PATTERN = /(^|[^a-z])(kauf|buy|eigentum|purchase)/;

/** Guess from a portal search URL whether it looks for rentals or for properties to buy. */
export function detectDealTypeFromUrl(url: unknown): DealType | null {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return null;
  }
  let haystack = url.toLowerCase();
  try {
    haystack = decodeURIComponent(haystack);
  } catch {
    // A malformed escape sequence is no reason to give up - match on the raw URL instead.
  }
  const hasRent = RENT_PATTERN.test(haystack);
  const hasBuy = BUY_PATTERN.test(haystack);
  if (hasRent === hasBuy) {
    return null;
  }
  return hasRent ? DEAL_TYPES.RENT : DEAL_TYPES.BUY;
}
