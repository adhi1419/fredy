/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { STALE_ARCHIVE_MS, isListingStaleForArchive } from '../../../lib/services/listings/staleArchive.js';

const NOW = 1_700_000_000_000;
const listingAt = (ageMs, lifecycleState = 'new') => ({ createdAt: NOW - ageMs, lifecycleState });

describe('isListingStaleForArchive', () => {
  it('uses a strict one-week boundary: just-below and exact are not stale, just-above is', () => {
    expect(isListingStaleForArchive(listingAt(STALE_ARCHIVE_MS - 1), { now: NOW })).toBe(false);
    expect(isListingStaleForArchive(listingAt(STALE_ARCHIVE_MS), { now: NOW })).toBe(false);
    expect(isListingStaleForArchive(listingAt(STALE_ARCHIVE_MS + 1), { now: NOW })).toBe(true);
  });

  it('never re-archives an already-archived listing, even when far past the boundary', () => {
    expect(isListingStaleForArchive(listingAt(30 * STALE_ARCHIVE_MS, 'archived'), { now: NOW })).toBe(false);
  });

  it('archives stale listings in the other active lifecycle states', () => {
    for (const state of ['new', 'applied', 'viewed']) {
      expect(isListingStaleForArchive(listingAt(STALE_ARCHIVE_MS + 1, state), { now: NOW })).toBe(true);
    }
  });

  it('never archives a listing whose age cannot be established', () => {
    expect(isListingStaleForArchive({ createdAt: null, lifecycleState: 'new' }, { now: NOW })).toBe(false);
    expect(isListingStaleForArchive({ createdAt: 'not-a-date', lifecycleState: 'new' }, { now: NOW })).toBe(false);
    expect(isListingStaleForArchive({}, { now: NOW })).toBe(false);
  });

  it('accepts numeric-string createdAt like the stored epoch millis', () => {
    expect(
      isListingStaleForArchive({ createdAt: String(NOW - STALE_ARCHIVE_MS - 1), lifecycleState: 'new' }, { now: NOW }),
    ).toBe(true);
  });
});
