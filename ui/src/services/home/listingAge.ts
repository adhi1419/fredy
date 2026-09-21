/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The relative age a Home card shows in place of an absolute timestamp. It is a pure function of
 * two numbers — the listing's `created_at` and a caller-supplied `now` — so the same inputs always
 * produce the same bucket, and a test can pin `now` rather than race the wall clock.
 *
 * The buckets are deliberately coarse: a card is scanned, not read, so the reader wants "roughly
 * how fresh" rather than a precise duration. Every bucket returns an i18n key plus the count the
 * label interpolates, never a rendered string, so the wording and pluralisation stay in the locale
 * files this module must not touch.
 *
 * Threshold semantics (age = now − created_at):
 *
 * | age range                | key                         | count |
 * |--------------------------|-----------------------------|-------|
 * | age < 1 minute (incl. 0  | home.ageMinute              | 1     |
 * |   and future/skew)       |                             |       |
 * | 1 min ≤ age < 2 min      | home.ageMinute              | 1     |
 * | 2 min ≤ age < 60 min     | home.ageMinutes             | 2..59 |
 * | 60 min ≤ age < 2 h       | home.ageHour                | 1     |
 * | 2 h ≤ age < 24 h         | home.ageHours               | 2..23 |
 * | 24 h ≤ age < 48 h         | home.ageYesterday   | —     |
 * | 48 h ≤ age < 7 days       | home.ageDays        | 2..6  |
 * | age ≥ 7 days              | home.ageLastWeek    | —     |
 *
 * The 7-day ceiling lines up with the backend auto-archive boundary (`> 7*24h`): a listing sitting
 * at exactly a week reads "Last week" here and is archived by the job run once it is strictly older,
 * so the oldest thing a New card ever shows is "Last week".
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** One relative-age bucket: an i18n key and, when the label pluralises, the count it interpolates. */
export interface ListingAge {
  /** The i18n key the caller renders. */
  readonly key: string;
  /** The count a `{{count}}` label interpolates, or null for the fixed-wording buckets. */
  readonly count: number | null;
}

/** Fixed buckets, exported so a test can assert the exact keys without duplicating the strings. */
export const LISTING_AGE_KEYS = Object.freeze({
  minute: 'home.ageMinute',
  minutes: 'home.ageMinutes',
  hour: 'home.ageHour',
  hours: 'home.ageHours',
  yesterday: 'home.ageYesterday',
  days: 'home.ageDays',
  lastWeek: 'home.ageLastWeek',
} as const);

/**
 * Bucket a listing's age into the descriptor a Home card renders.
 *
 * @param createdAt Stored creation time (epoch millis). A missing or non-finite value yields null.
 * @param now Reference time (epoch millis); defaults to the wall clock.
 * @returns The age descriptor, or null when `createdAt` is unusable.
 */
export function relativeListingAge(
  createdAt: number | string | null | undefined,
  now: number = Date.now(),
): ListingAge | null {
  // Reject nullish and empty inputs before coercion: Number(null) and Number('') are 0, which is
  // finite and would otherwise read as a valid (very old) timestamp.
  if (createdAt == null || createdAt === '') return null;
  const created = typeof createdAt === 'number' ? createdAt : Number(createdAt);
  if (!Number.isFinite(created)) return null;

  // Clock skew or a future timestamp collapses to the freshest bucket rather than a negative age.
  const age = Math.max(0, now - created);
  if (age < HOUR_MS) {
    // Floor to one minute so a listing seconds old still reads "1 min ago" rather than "0 mins".
    const minutes = Math.max(1, Math.floor(age / MINUTE_MS));
    return { key: minutes === 1 ? LISTING_AGE_KEYS.minute : LISTING_AGE_KEYS.minutes, count: minutes };
  }
  if (age < DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    return { key: hours === 1 ? LISTING_AGE_KEYS.hour : LISTING_AGE_KEYS.hours, count: hours };
  }
  if (age < 2 * DAY_MS) {
    return { key: LISTING_AGE_KEYS.yesterday, count: null };
  }
  if (age < WEEK_MS) {
    return { key: LISTING_AGE_KEYS.days, count: Math.floor(age / DAY_MS) };
  }
  return { key: LISTING_AGE_KEYS.lastWeek, count: null };
}
