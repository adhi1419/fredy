/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { MonitoringBucket, MonitoringQuery } from '../../../services/state/adminState.js';

export type MonitoringRangeKey = '24h' | '7d' | '30d' | 'mtd';
const DAY_MS = 24 * 60 * 60 * 1000;

export function monitoringRangeFor(key: MonitoringRangeKey, now = Date.now()): MonitoringQuery {
  const current = new Date(now);
  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1).getTime();
  const duration = key === '24h' ? DAY_MS : key === '7d' ? 7 * DAY_MS : 30 * DAY_MS;
  return { start: key === 'mtd' ? monthStart : now - duration, end: now, monthStart };
}

function addCounters(target: MonitoringBucket['counters'], source: MonitoringBucket['counters']) {
  for (const key of Object.keys(target) as (keyof MonitoringBucket['counters'])[]) target[key] += source[key];
}

/** Combine UTC hourly persistence into calendar days in the admin's browser timezone. */
export function monitoringDailyBuckets(buckets: readonly MonitoringBucket[]): MonitoringBucket[] {
  const days = new Map<string, MonitoringBucket>();
  for (const bucket of buckets) {
    const date = new Date(bucket.start);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const existing = days.get(key);
    if (existing == null) {
      days.set(key, { ...bucket, counters: { ...bucket.counters } });
      continue;
    }
    existing.end = bucket.end;
    existing.activeListings = bucket.activeListings;
    existing.sampled ||= bucket.sampled;
    addCounters(existing.counters, bucket.counters);
  }
  return [...days.values()];
}
