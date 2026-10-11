/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getGoogleAccessToken } from '../firebaseAdmin.js';

const METRICS = Object.freeze({
  cloudRunRequests: ['run.googleapis.com/request_count', 'ALIGN_SUM'],
  cloudRunBillableSeconds: ['run.googleapis.com/container/billable_instance_time', 'ALIGN_SUM'],
  firestoreReads: ['firestore.googleapis.com/document/read_count', 'ALIGN_SUM'],
  firestoreWrites: ['firestore.googleapis.com/document/write_count', 'ALIGN_SUM'],
  firestoreDeletes: ['firestore.googleapis.com/document/delete_count', 'ALIGN_SUM'],
  firestoreStorageBytes: ['firestore.googleapis.com/storage/data_and_index_storage_bytes', 'ALIGN_MEAN'],
});

const PRICING = Object.freeze({
  cloudRunCpuSecond: 0.000024,
  cloudRunGibSecond: 0.0000025,
  cloudRunMillionRequests: 0.4,
  cloudRunFreeCpuSeconds: 180_000,
  cloudRunFreeGibSeconds: 360_000,
  cloudRunFreeRequests: 2_000_000,
  firestoreRead100k: 0.03,
  firestoreWrite100k: 0.09,
  firestoreDelete100k: 0.01,
  firestoreFreeReadsPerDay: 50_000,
  firestoreFreeWritesPerDay: 20_000,
  firestoreFreeDeletesPerDay: 20_000,
  firestoreFreeStorageGib: 1,
  firestoreStorageGibMonth: 0.18,
});

function projectId() {
  return (
    process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.FIRESTORE_PROJECT_ID || null
  );
}

async function googleJson(url, init = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

function pointValue(point) {
  const raw = point?.value?.int64Value ?? point?.value?.doubleValue ?? 0;
  const number = Number(raw);
  return Number.isFinite(number) ? number : 0;
}

async function loadMetric(project, metricType, aligner, start, end) {
  const pointsByEnd = new Map();
  let pageToken = null;
  let pages = 0;
  do {
    pages += 1;
    const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries`);
    url.searchParams.set('filter', `metric.type = "${metricType}"`);
    url.searchParams.set('interval.startTime', new Date(start).toISOString());
    url.searchParams.set('interval.endTime', new Date(end).toISOString());
    url.searchParams.set('aggregation.alignmentPeriod', '3600s');
    url.searchParams.set('aggregation.perSeriesAligner', aligner);
    url.searchParams.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
    url.searchParams.set('view', 'FULL');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await googleJson(url);
    for (const series of body.timeSeries ?? []) {
      for (const point of series.points ?? []) {
        const timestamp = Date.parse(point.interval?.endTime ?? '');
        if (!Number.isFinite(timestamp)) continue;
        pointsByEnd.set(timestamp, (pointsByEnd.get(timestamp) ?? 0) + pointValue(point));
      }
    }
    pageToken = body.nextPageToken ?? null;
    if (pageToken && pages >= 20) throw new Error('Cloud Monitoring response exceeded 20 pages');
  } while (pageToken);
  return [...pointsByEnd].sort((a, b) => a[0] - b[0]).map(([timestamp, value]) => ({ timestamp, value }));
}

/** Load hourly built-in GCP metrics. Built-in metrics have no custom ingestion charge. */
export async function loadCloudUsage(start, end) {
  const project = projectId();
  if (!project) return { status: 'unavailable', reason: 'Google Cloud project is not configured', series: {} };
  try {
    const entries = await Promise.all(
      Object.entries(METRICS).map(async ([name, [type, aligner]]) => [
        name,
        await loadMetric(project, type, aligner, start, end),
      ]),
    );
    return { status: 'available', projectId: project, series: Object.fromEntries(entries) };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'Cloud Monitoring unavailable',
      series: {},
    };
  }
}

function inRange(points, start, end) {
  return (points ?? []).filter((point) => point.timestamp > start && point.timestamp <= end);
}

function sum(points) {
  return points.reduce((total, point) => total + point.value, 0);
}

function latest(points) {
  return points.length === 0 ? 0 : points[points.length - 1].value;
}

/** Consumption totals for the selected dashboard range. */
export function summarizeCloudUsage(usage, start, end) {
  const series = usage?.series ?? {};
  const billableSeconds = sum(inRange(series.cloudRunBillableSeconds, start, end));
  const vcpu = positiveNumber(process.env.MONITORING_CLOUD_RUN_VCPU, 1);
  const memoryGib = positiveNumber(process.env.MONITORING_CLOUD_RUN_MEMORY_GIB, 0.5);
  return {
    cloudRun: {
      requests: sum(inRange(series.cloudRunRequests, start, end)),
      billableInstanceSeconds: billableSeconds,
      vCpuSeconds: billableSeconds * vcpu,
      gibibyteSeconds: billableSeconds * memoryGib,
    },
    firestore: {
      reads: sum(inRange(series.firestoreReads, start, end)),
      writes: sum(inRange(series.firestoreWrites, start, end)),
      deletes: sum(inRange(series.firestoreDeletes, start, end)),
      storageBytes: latest(inRange(series.firestoreStorageBytes, start, end)),
    },
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function quotaDay(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

function dailyCost(points, freePerDay, pricePer100k) {
  const days = new Map();
  for (const point of points)
    days.set(quotaDay(point.timestamp), (days.get(quotaDay(point.timestamp)) ?? 0) + point.value);
  return [...days.values()].reduce(
    (cost, count) => cost + (Math.max(0, count - freePerDay) / 100_000) * pricePer100k,
    0,
  );
}

/** Estimate MTD Cloud Run + Firestore cost from current public list prices and free quotas. */
export function estimateRuntimeCost(usage, start, end) {
  if (usage?.status !== 'available') return { status: 'unavailable', currency: 'USD', amount: null };
  const series = usage.series;
  const billableSeconds = sum(inRange(series.cloudRunBillableSeconds, start, end));
  const requests = sum(inRange(series.cloudRunRequests, start, end));
  const vcpu = positiveNumber(process.env.MONITORING_CLOUD_RUN_VCPU, 1);
  const memoryGib = positiveNumber(process.env.MONITORING_CLOUD_RUN_MEMORY_GIB, 0.5);
  const cloudRun =
    Math.max(0, billableSeconds * vcpu - PRICING.cloudRunFreeCpuSeconds) * PRICING.cloudRunCpuSecond +
    Math.max(0, billableSeconds * memoryGib - PRICING.cloudRunFreeGibSeconds) * PRICING.cloudRunGibSecond +
    (Math.max(0, requests - PRICING.cloudRunFreeRequests) / 1_000_000) * PRICING.cloudRunMillionRequests;
  const reads = inRange(series.firestoreReads, start, end);
  const writes = inRange(series.firestoreWrites, start, end);
  const deletes = inRange(series.firestoreDeletes, start, end);
  const storage = inRange(series.firestoreStorageBytes, start, end);
  const firestore =
    dailyCost(reads, PRICING.firestoreFreeReadsPerDay, PRICING.firestoreRead100k) +
    dailyCost(writes, PRICING.firestoreFreeWritesPerDay, PRICING.firestoreWrite100k) +
    dailyCost(deletes, PRICING.firestoreFreeDeletesPerDay, PRICING.firestoreDelete100k) +
    storage.reduce(
      (cost, point) =>
        cost +
        (Math.max(0, point.value / 1024 ** 3 - PRICING.firestoreFreeStorageGib) / 730) *
          PRICING.firestoreStorageGibMonth,
      0,
    );
  const usd = cloudRun + firestore;
  const multiplier = positiveNumber(process.env.MONITORING_USD_TO_CURRENCY, 1);
  return {
    status: 'estimated',
    currency: process.env.MONITORING_ESTIMATE_CURRENCY || 'USD',
    amount: usd * multiplier,
    components: { cloudRun: cloudRun * multiplier, firestore: firestore * multiplier },
    assumptions: { vcpu, memoryGib, pricing: 'list-price-defaults', freeQuotasApplied: true },
  };
}
