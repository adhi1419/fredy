/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getJobs } from '../storage/jobStorage.js';
import { latestRollupBefore, listHourlyRollups, listProviderRuns } from '../storage/firestore/monitoringStorage.js';
import { emptyMonitoringCounters, addMonitoringCounters, normalizeMonitoringCounters } from './monitoringCounters.js';
import { estimateRuntimeCost, loadCloudUsage, summarizeCloudUsage } from './googleCloudUsage.js';
import { estimateProjectCost, loadActualBillingCost } from './billingExport.js';

const HOUR_MS = 60 * 60 * 1000;

function matches(row, jobId, providerId) {
  return (jobId == null || row.jobId === jobId) && (providerId == null || row.providerId === providerId);
}

function countersFor(rollup, jobId, providerId) {
  if (jobId == null && providerId == null) return normalizeMonitoringCounters(rollup?.counters);
  const total = emptyMonitoringCounters();
  for (const row of rollup?.counterDimensions ?? []) {
    if (matches(row, jobId, providerId)) addMonitoringCounters(total, row.counters);
  }
  return total;
}

function activeFor(rollup, jobId, providerId, fallback = 0) {
  if (!Array.isArray(rollup?.activeDimensions)) return fallback;
  return rollup.activeDimensions
    .filter((row) => matches(row, jobId, providerId))
    .reduce((total, row) => total + (Number(row.count) || 0), 0);
}

export function fillHourlyBuckets({ start, end, rollups, baseline, jobId, providerId }) {
  const byHour = new Map(rollups.map((rollup) => [Number(rollup.bucketStart), rollup]));
  let activeListings = activeFor(baseline, jobId, providerId, 0);
  const buckets = [];
  for (let bucketStart = Math.floor(start / HOUR_MS) * HOUR_MS; bucketStart < end; bucketStart += HOUR_MS) {
    const rollup = byHour.get(bucketStart);
    if (rollup != null) activeListings = activeFor(rollup, jobId, providerId, activeListings);
    buckets.push({
      start: bucketStart,
      end: bucketStart + HOUR_MS,
      activeListings,
      counters: countersFor(rollup, jobId, providerId),
      sampled: rollup != null,
    });
  }
  return buckets;
}

function filterOptions(jobs) {
  const providers = new Map();
  for (const job of jobs) {
    for (const provider of job.provider ?? []) {
      if (typeof provider?.id === 'string') providers.set(provider.id, provider.name ?? provider.id);
    }
  }
  return {
    jobs: jobs.map((job) => ({ id: job.id, name: job.name ?? job.id })),
    providers: [...providers].map(([id, name]) => ({ id, name })),
  };
}

/** Build the complete admin Monitoring response. External sources fail independently. */
export async function getMonitoringOverview({ start, end, monthStart, jobId = null, providerId = null }) {
  const usageStart = Math.min(start, monthStart);
  const [rollups, baseline, jobs, usage, actual] = await Promise.all([
    listHourlyRollups(start, end),
    latestRollupBefore(start),
    getJobs(),
    loadCloudUsage(usageStart, end),
    loadActualBillingCost(monthStart, end),
  ]);
  return {
    generatedAt: Date.now(),
    range: { start, end, monthStart },
    selected: { jobId, providerId },
    filters: filterOptions(jobs),
    cost: {
      project: { actual, estimate: estimateProjectCost(actual, monthStart, end) },
      runtime: {
        actual: {
          status: actual.status,
          amount: actual.runtimeAmount ?? null,
          currency: actual.currency ?? null,
          through: actual.through ?? null,
        },
        estimate: estimateRuntimeCost(usage, monthStart, end),
      },
    },
    consumption: {
      status: usage.status,
      reason: usage.reason ?? null,
      ...summarizeCloudUsage(usage, start, end),
    },
    buckets: fillHourlyBuckets({ start, end, rollups, baseline, jobId, providerId }),
    overhead: {
      providerPass: { reads: 3, writesNormally: 2, writesWhenActiveCountChanges: 3 },
      refresh: {
        rollupReads: rollups.length + (baseline == null ? 0 : 1),
        externalApiCalls: 7 + (actual.status === 'not-configured' ? 0 : 1),
      },
    },
  };
}

/** List the provider runs contributing to one selected chart bucket. */
export async function getMonitoringRuns({ start, end, jobId = null, providerId = null }) {
  const runs = await listProviderRuns(start, end);
  return {
    runs: runs.filter((run) => matches(run, jobId, providerId)),
    range: { start, end },
  };
}
