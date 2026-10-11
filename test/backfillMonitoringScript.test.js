/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKFILL_ID,
  MAX_BACKFILL_DAYS,
  collectListingDecisionEvents,
  finalizeBackfill,
  formatSummary,
  parseArguments,
} from '../scripts/backfill-monitoring.js';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/backfill-monitoring.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const decision = (listingId, overrides = {}) => ({
  event: 'listing_decision',
  schemaVersion: 1,
  jobId: 'job-1',
  providerId: 'provider-1',
  listingId,
  flow: 'new',
  decision: 'failed',
  reason: 'delivery-error',
  status: 'failed',
  ...overrides,
});

const entry = (timestamp, event) => ({
  timestamp,
  textPayload: `LISTING_DECISION ${JSON.stringify(event)}`,
});

function monitoringDouble() {
  return {
    createMonitoringAccumulator: () => ({ counters: { newListings: 0 }, outcomes: new Map() }),
    recordListingDecisionMetric: (accumulator, event, happenedAt) => {
      const outcome = accumulator.outcomes.get(event.listingId) ?? {
        listingId: event.listingId,
        stored: false,
        outcome: null,
        reason: null,
        happenedAt,
      };
      outcome.happenedAt = happenedAt;
      if (event.decision === 'stored') {
        outcome.stored = true;
        outcome.reason ??= event.reason ?? null;
        accumulator.counters.newListings += 1;
      }
      if (event.decision === 'sent' && event.status === 'sent') outcome.outcome = 'provider-confirmed';
      if (event.decision === 'failed' && event.status === 'failed') outcome.outcome = 'retryable';
      if (event.decision === 'failed' && event.status === 'rejected') outcome.outcome = 'terminal';
      if (outcome.outcome != null) outcome.reason = event.reason ?? null;
      accumulator.outcomes.set(event.listingId, outcome);
    },
    finalizeMonitoringListingOutcomes: (accumulator) => [...accumulator.outcomes.values()],
  };
}

describe('Monitoring backfill command lifecycle', () => {
  it('initializes Firestore before both writes and closes it afterwards', () => {
    const initialize = source.indexOf('await FirestoreConnection.init()');
    const rollupWrite = source.indexOf('await mergeHistoricalHour(');
    const historyWrite = source.indexOf('await mergeHistoricalListingHour(');
    const close = source.indexOf('await FirestoreConnection.close()');
    expect(initialize).toBeGreaterThan(0);
    expect(rollupWrite).toBeGreaterThan(initialize);
    expect(historyWrite).toBeGreaterThan(rollupWrite);
    expect(close).toBeGreaterThan(historyWrite);
  });

  it('collapses failed then rejected decisions while preserving stored=true', () => {
    const monitoring = monitoringDouble();
    const timestamp = '2026-10-11T10:34:00.000Z';
    const collected = collectListingDecisionEvents(
      [
        entry(timestamp, decision('listing-1', { decision: 'stored', reason: 'stored', status: null })),
        entry(timestamp, decision('listing-1')),
        entry(timestamp, decision('listing-1', { status: 'rejected' })),
      ],
      monitoring,
    );

    const finalized = finalizeBackfill(collected.hours, monitoring);
    expect(finalized.uniqueListingOutcomeCount).toBe(1);
    expect([...finalized.listingHistory.values()]).toEqual([
      [
        {
          jobId: 'job-1',
          providerId: 'provider-1',
          listingId: 'listing-1',
          stored: true,
          outcome: 'terminal',
          reason: 'delivery-error',
          happenedAt: Date.parse(timestamp),
        },
      ],
    ]);
    expect([...finalized.counterDimensions.values()][0][0].counters).toEqual({ newListings: 1 });
  });

  it('groups listing history into one document per UTC hour and keeps dimensions separate', () => {
    const monitoring = monitoringDouble();
    const collected = collectListingDecisionEvents(
      [
        entry(
          '2026-10-11T10:34:00.000Z',
          decision('listing-1', { decision: 'stored', reason: 'stored', status: null }),
        ),
        entry(
          '2026-10-11T10:55:00.000Z',
          decision('listing-2', { providerId: 'provider-2', decision: 'stored', reason: 'stored', status: null }),
        ),
      ],
      monitoring,
    );

    const finalized = finalizeBackfill(collected.hours, monitoring);
    expect(finalized.listingHistory.size).toBe(1);
    expect([...finalized.listingHistory.values()][0]).toHaveLength(2);
    expect([...finalized.counterDimensions.values()][0]).toHaveLength(2);
  });

  it('keeps the stable backfill id for rerun idempotency and caps the date range', () => {
    expect(BACKFILL_ID).toBe('cloud-logging-listing-decisions-v1');
    expect(source).toMatch(/mergeHistoricalHour\(\{[\s\S]*backfillId: BACKFILL_ID/);
    expect(source).toMatch(/mergeHistoricalListingHour\(\{[\s\S]*backfillId: BACKFILL_ID/);
    expect(parseArguments(['31', '--dry-run'])).toEqual({ days: MAX_BACKFILL_DAYS, dryRun: true });
    const summary = formatSummary({
      dryRun: true,
      entriesRead: 3,
      rollupHourCount: 1,
      uniqueListingOutcomeCount: 1,
      historyDocumentCount: 1,
      truncatedHistoryDocumentCount: 2,
    });
    expect(summary).toContain('3 events into 1 rollup hours; 1 unique listing outcomes; 1 history documents');
    expect(summary).toContain('2 history documents exceed the listing-outcome cap');
  });
});
