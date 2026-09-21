/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  HOUR_MS,
  LISTING_AGE_KEYS,
  MINUTE_MS,
  WEEK_MS,
  relativeListingAge,
} from '../../ui/src/services/home/listingAge.js';

const NOW = 1_700_000_000_000;
const at = (ageMs: number) => relativeListingAge(NOW - ageMs, NOW);

describe('relativeListingAge', () => {
  it('floors the freshest bucket to one minute for seconds-old and skewed timestamps', () => {
    expect(at(0)).toEqual({ key: LISTING_AGE_KEYS.minute, count: 1 });
    expect(at(30 * 1000)).toEqual({ key: LISTING_AGE_KEYS.minute, count: 1 });
    // A future/clock-skewed timestamp collapses to the freshest bucket rather than a negative age.
    expect(relativeListingAge(NOW + 5 * MINUTE_MS, NOW)).toEqual({ key: LISTING_AGE_KEYS.minute, count: 1 });
  });

  it('reports whole minutes up to the hour boundary', () => {
    expect(at(MINUTE_MS)).toEqual({ key: LISTING_AGE_KEYS.minute, count: 1 });
    expect(at(35 * MINUTE_MS)).toEqual({ key: LISTING_AGE_KEYS.minutes, count: 35 });
    expect(at(59 * MINUTE_MS)).toEqual({ key: LISTING_AGE_KEYS.minutes, count: 59 });
  });

  it('reports whole hours from one hour up to one day', () => {
    expect(at(HOUR_MS)).toEqual({ key: LISTING_AGE_KEYS.hour, count: 1 });
    expect(at(12 * HOUR_MS)).toEqual({ key: LISTING_AGE_KEYS.hours, count: 12 });
    expect(at(23 * HOUR_MS + 59 * MINUTE_MS)).toEqual({ key: LISTING_AGE_KEYS.hours, count: 23 });
  });

  it('reads Yesterday across the whole second day', () => {
    expect(at(DAY_MS)).toEqual({ key: LISTING_AGE_KEYS.yesterday, count: null });
    expect(at(2 * DAY_MS - 1)).toEqual({ key: LISTING_AGE_KEYS.yesterday, count: null });
  });

  it('reports 2..6 days from the third day up to (but not including) one week', () => {
    expect(at(2 * DAY_MS)).toEqual({ key: LISTING_AGE_KEYS.days, count: 2 });
    expect(at(6 * DAY_MS)).toEqual({ key: LISTING_AGE_KEYS.days, count: 6 });
    expect(at(WEEK_MS - 1)).toEqual({ key: LISTING_AGE_KEYS.days, count: 6 });
  });

  it('reads Last week at exactly one week and beyond, matching the archive edge', () => {
    expect(at(WEEK_MS)).toEqual({ key: LISTING_AGE_KEYS.lastWeek, count: null });
    expect(at(WEEK_MS + DAY_MS)).toEqual({ key: LISTING_AGE_KEYS.lastWeek, count: null });
  });

  it('accepts numeric strings and rejects unusable timestamps', () => {
    expect(relativeListingAge(String(NOW - 35 * MINUTE_MS), NOW)).toEqual({
      key: LISTING_AGE_KEYS.minutes,
      count: 35,
    });
    expect(relativeListingAge(null, NOW)).toBeNull();
    expect(relativeListingAge(undefined, NOW)).toBeNull();
    expect(relativeListingAge('not-a-date', NOW)).toBeNull();
  });
});
