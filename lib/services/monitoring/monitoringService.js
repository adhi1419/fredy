/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getJobs } from '../storage/jobStorage.js';
import {
  latestRollupBefore,
  listHistoricalListingOutcomes,
  listHourlyRollups,
  listProviderRuns,
} from '../storage/firestore/monitoringStorage.js';
import { COLLECTIONS, getDocsByIds } from '../storage/firestore/collections.js';
import { emptyMonitoringCounters, addMonitoringCounters, normalizeMonitoringCounters } from './monitoringCounters.js';
import { estimateRuntimeCost, loadCloudUsage, summarizeCloudUsage } from './googleCloudUsage.js';
import { estimateProjectCost, loadActualBillingCost } from './billingExport.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_FLATTENED_LISTINGS = 500;

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

function metadataForJobs(jobs) {
  const metadata = new Map();
  for (const job of jobs ?? []) {
    const providers = new Map(
      (job.provider ?? [])
        .filter((provider) => typeof provider?.id === 'string')
        .map((provider) => [provider.id, provider.name ?? provider.id]),
    );
    metadata.set(job.id, { jobName: job.name ?? job.id, providers });
  }
  return metadata;
}

function providerNameFor(metadata, jobId, providerId) {
  return metadata.get(jobId)?.providers.get(providerId) ?? providerId ?? null;
}

function addListingCandidate(candidates, candidate, priority) {
  if (typeof candidate?.listingId !== 'string' || candidate.listingId.length === 0) return;
  if (typeof candidate?.jobId !== 'string' || typeof candidate?.providerId !== 'string') return;
  if (typeof candidate?.outcome !== 'string') return;
  const key = `${candidate.jobId}\0${candidate.providerId}\0${candidate.listingId}`;
  const happenedAt = Number(candidate.happenedAt);
  const normalized = {
    listingId: candidate.listingId,
    happenedAt: Number.isFinite(happenedAt) ? happenedAt : 0,
    jobId: candidate.jobId,
    jobName: candidate.jobName ?? null,
    providerId: candidate.providerId,
    providerName: candidate.providerName ?? null,
    stored: candidate.stored === true,
    outcome: candidate.outcome,
    reason: candidate.reason ?? null,
    priority,
  };
  const previous = candidates.get(key);
  if (
    previous == null ||
    normalized.happenedAt > previous.happenedAt ||
    (normalized.happenedAt === previous.happenedAt && priority > previous.priority)
  ) {
    candidates.set(key, normalized);
  }
}

function candidatesFromRuns(runs, jobMetadata) {
  const candidates = new Map();
  for (const run of runs ?? []) {
    for (const outcome of run.listingOutcomes ?? []) {
      addListingCandidate(
        candidates,
        {
          ...outcome,
          happenedAt: outcome.happenedAt ?? run.finishedAt,
          jobId: run.jobId,
          jobName: run.jobName ?? jobMetadata.get(run.jobId)?.jobName ?? null,
          providerId: run.providerId,
          providerName: run.providerName ?? providerNameFor(jobMetadata, run.jobId, run.providerId),
        },
        2,
      );
    }
  }
  return candidates;
}

function candidatesFromHistory(history, jobMetadata, candidates, jobId, providerId) {
  for (const hour of history ?? []) {
    for (const outcome of hour.listingOutcomes ?? []) {
      if (!matches(outcome, jobId, providerId)) continue;
      addListingCandidate(
        candidates,
        {
          ...outcome,
          happenedAt: outcome.happenedAt ?? hour.bucketStart,
          jobName: outcome.jobName ?? jobMetadata.get(outcome.jobId)?.jobName ?? null,
          providerName: outcome.providerName ?? providerNameFor(jobMetadata, outcome.jobId, outcome.providerId),
        },
        1,
      );
    }
  }
}

/**
 * Hydrate only the non-sensitive title and provider URL from listing documents. Missing documents
 * deliberately remain visible as null metadata: deleted listings must not be resurrected by an old
 * monitoring event. getDocsByIds performs bounded 500-document batches.
 */
export async function hydrateMonitoringListings(candidates) {
  const bounded = [...candidates]
    .sort((a, b) => Number(b.happenedAt) - Number(a.happenedAt) || a.listingId.localeCompare(b.listingId))
    .slice(0, MAX_FLATTENED_LISTINGS);
  const ids = [...new Set(bounded.map((candidate) => candidate.listingId))];
  const snapshots = await getDocsByIds(COLLECTIONS.LISTINGS, ids);
  const documents = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.data()]));
  return bounded
    .map((candidate) => {
      const listing = documents.get(candidate.listingId);
      return {
        listingId: candidate.listingId,
        happenedAt: candidate.happenedAt,
        jobId: candidate.jobId,
        jobName: candidate.jobName,
        providerId: candidate.providerId,
        providerName: candidate.providerName,
        stored: candidate.stored,
        outcome: candidate.outcome,
        reason: candidate.reason,
        title: listing?.title ?? null,
        providerUrl: listing?.link ?? null,
      };
    })
    .sort((a, b) => b.happenedAt - a.happenedAt || a.listingId.localeCompare(b.listingId));
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

/** List provider runs and the deduplicated listing ledger for the selected monitoring bucket. */
export async function getMonitoringRuns({ start, end, jobId = null, providerId = null }) {
  const [allRuns, history, jobs] = await Promise.all([
    listProviderRuns(start, end),
    listHistoricalListingOutcomes(start, end),
    getJobs({ includeDisabled: true }),
  ]);
  const runs = allRuns.filter((run) => matches(run, jobId, providerId));
  const jobMetadata = metadataForJobs(jobs);
  const candidates = candidatesFromRuns(runs, jobMetadata);
  candidatesFromHistory(history, jobMetadata, candidates, jobId, providerId);
  const candidateValues = [...candidates.values()];
  const listingsTruncated =
    candidateValues.length > MAX_FLATTENED_LISTINGS ||
    runs.some((run) => Number(run.listingOutcomesTruncated) > 0) ||
    history.some((hour) => Number(hour.listingOutcomesTruncated) > 0);
  const listings = await hydrateMonitoringListings(candidateValues);
  return {
    runs,
    listings,
    listingsTruncated,
    range: { start, end },
  };
}
