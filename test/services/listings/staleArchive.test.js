/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_STATE,
  AUTO_ARCHIVE_WINDOWS_MS,
  MIN_AUTO_ARCHIVE_MS,
  isListingStaleForArchive,
} from '../../../lib/services/listings/staleArchive.js';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Build the resolved lifecycle object `lifecycleFromData` would hand the rule. */
const lifecycle = ({ state = 'new', changedAt = null, appliedAt = null, viewedAt = null } = {}) => ({
  state,
  source: null,
  changedAt,
  changedBy: null,
  appliedAt,
  viewedAt,
});

/** A listing whose reference timestamp sits `ageMs` before NOW, in the given state. */
const listing = ({ ageMs, state = 'new', from = 'createdAt' } = {}) => {
  const ts = NOW - ageMs;
  const lc = lifecycle({ state });
  if (from === 'appliedAt') lc.appliedAt = ts;
  else if (from === 'viewedAt') lc.viewedAt = ts;
  else if (from === 'changedAt') lc.changedAt = ts;
  // createdAt always carries a very old value so a fallback can be distinguished from it.
  const createdAt = from === 'createdAt' ? ts : NOW - 10 * 365 * DAY_MS;
  return { createdAt, lifecycle: lc };
};

describe('AUTO_ARCHIVE_WINDOWS_MS / MIN_AUTO_ARCHIVE_MS', () => {
  it('exposes the per-state windows and the smallest of them', () => {
    expect(AUTO_ARCHIVE_WINDOWS_MS).toEqual({ new: 14 * DAY_MS, applied: 30 * DAY_MS, viewed: 45 * DAY_MS });
    expect(MIN_AUTO_ARCHIVE_MS).toBe(14 * DAY_MS);
    expect(ARCHIVED_STATE).toBe('archived');
  });

  it('is frozen so a caller cannot mutate a window', () => {
    expect(Object.isFrozen(AUTO_ARCHIVE_WINDOWS_MS)).toBe(true);
  });
});

describe('isListingStaleForArchive', () => {
  it('new: strict 14-day boundary from createdAt — exact kept, +1ms archived', () => {
    expect(isListingStaleForArchive(listing({ ageMs: 14 * DAY_MS, state: 'new' }), { now: NOW })).toBe(false);
    expect(isListingStaleForArchive(listing({ ageMs: 14 * DAY_MS + 1, state: 'new' }), { now: NOW })).toBe(true);
    expect(isListingStaleForArchive(listing({ ageMs: 14 * DAY_MS - 1, state: 'new' }), { now: NOW })).toBe(false);
  });

  it('applied: 29 days kept, 31 days archived — measured from appliedAt', () => {
    expect(
      isListingStaleForArchive(listing({ ageMs: 29 * DAY_MS, state: 'applied', from: 'appliedAt' }), { now: NOW }),
    ).toBe(false);
    expect(
      isListingStaleForArchive(listing({ ageMs: 31 * DAY_MS, state: 'applied', from: 'appliedAt' }), { now: NOW }),
    ).toBe(true);
  });

  it('viewed: 44 days kept, 46 days archived — measured from viewedAt', () => {
    expect(
      isListingStaleForArchive(listing({ ageMs: 44 * DAY_MS, state: 'viewed', from: 'viewedAt' }), { now: NOW }),
    ).toBe(false);
    expect(
      isListingStaleForArchive(listing({ ageMs: 46 * DAY_MS, state: 'viewed', from: 'viewedAt' }), { now: NOW }),
    ).toBe(true);
  });

  it('applied with no appliedAt falls back to changedAt', () => {
    // changedAt sits at 31 days, createdAt is ancient — the applied window (30d) is still measured
    // from changedAt, so the row is stale by the fallback, not by createdAt.
    const row = listing({ ageMs: 31 * DAY_MS, state: 'applied', from: 'changedAt' });
    expect(row.lifecycle.appliedAt).toBeNull();
    expect(isListingStaleForArchive(row, { now: NOW })).toBe(true);
    // At 29 days by changedAt it is kept, proving createdAt is not what drives it.
    const young = listing({ ageMs: 29 * DAY_MS, state: 'applied', from: 'changedAt' });
    expect(isListingStaleForArchive(young, { now: NOW })).toBe(false);
  });

  it('applied with no appliedAt and no changedAt falls back to createdAt', () => {
    const row = { createdAt: NOW - 31 * DAY_MS, lifecycle: lifecycle({ state: 'applied' }) };
    expect(isListingStaleForArchive(row, { now: NOW })).toBe(true);
    const young = { createdAt: NOW - 29 * DAY_MS, lifecycle: lifecycle({ state: 'applied' }) };
    expect(isListingStaleForArchive(young, { now: NOW })).toBe(false);
  });

  it('never re-archives an already-archived listing, even when far past every window', () => {
    expect(
      isListingStaleForArchive(
        { createdAt: NOW - 100 * DAY_MS, lifecycle: lifecycle({ state: 'archived' }) },
        { now: NOW },
      ),
    ).toBe(false);
  });

  it('never archives a listing whose reference time cannot be established', () => {
    expect(isListingStaleForArchive({ createdAt: null, lifecycle: lifecycle({ state: 'new' }) }, { now: NOW })).toBe(
      false,
    );
    expect(
      isListingStaleForArchive({ createdAt: 'not-a-date', lifecycle: lifecycle({ state: 'new' }) }, { now: NOW }),
    ).toBe(false);
    expect(isListingStaleForArchive({}, { now: NOW })).toBe(false);
  });

  it('accepts numeric-string timestamps like the stored epoch millis', () => {
    expect(
      isListingStaleForArchive(
        { createdAt: String(NOW - 14 * DAY_MS - 1), lifecycle: lifecycle({ state: 'new' }) },
        { now: NOW },
      ),
    ).toBe(true);
  });
});
