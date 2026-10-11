/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it } from 'vitest';
import { estimateRuntimeCost, summarizeCloudUsage } from '../../../lib/services/monitoring/googleCloudUsage.js';

const hour = Date.parse('2026-10-02T12:00:00Z');
const usage = (series) => ({ status: 'available', series });
const point = (timestamp, value) => ({ timestamp, value });

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Google Cloud monitoring cost model', () => {
  it('summarizes only points inside the selected range', () => {
    const result = summarizeCloudUsage(
      usage({
        cloudRunRequests: [point(hour - 2000, 50), point(hour, 10)],
        cloudRunBillableSeconds: [point(hour, 20)],
        firestoreReads: [point(hour, 30)],
        firestoreWrites: [point(hour, 4)],
        firestoreDeletes: [point(hour, 2)],
        firestoreStorageBytes: [point(hour, 1024)],
      }),
      hour - 1000,
      hour,
    );
    expect(result.cloudRun).toMatchObject({ requests: 10, billableInstanceSeconds: 20, vCpuSeconds: 20 });
    expect(result.firestore).toEqual({ reads: 30, writes: 4, deletes: 2, storageBytes: 1024 });
  });

  it('prices usage above free quotas while leaving small Fredy usage at zero', () => {
    process.env.MONITORING_CLOUD_RUN_VCPU = '1';
    process.env.MONITORING_CLOUD_RUN_MEMORY_GIB = '0.5';
    const free = estimateRuntimeCost(
      usage({
        cloudRunRequests: [point(hour, 100)],
        cloudRunBillableSeconds: [point(hour, 100)],
        firestoreReads: [point(hour, 100)],
        firestoreWrites: [point(hour, 100)],
        firestoreDeletes: [point(hour, 100)],
        firestoreStorageBytes: [point(hour, 1024 ** 3)],
      }),
      hour - 3600000,
      hour,
    );
    expect(free.amount).toBe(0);

    const billed = estimateRuntimeCost(
      usage({
        cloudRunRequests: [point(hour, 3_000_000)],
        cloudRunBillableSeconds: [point(hour, 200_000)],
        firestoreReads: [point(hour, 150_000)],
        firestoreWrites: [],
        firestoreDeletes: [],
        firestoreStorageBytes: [],
      }),
      hour - 3600000,
      hour,
    );
    expect(billed.status).toBe('estimated');
    expect(billed.components.cloudRun).toBeGreaterThan(0);
    expect(billed.components.firestore).toBeCloseTo(0.03);
  });
});
