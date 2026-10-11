/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  addMonitoringCounters,
  emptyMonitoringCounters,
  normalizeMonitoringCounters,
  recordListingDecisionMetric,
} from '../../../lib/services/monitoring/monitoringCounters.js';

describe('monitoring counters', () => {
  it('classifies stored, confirmed, and each failed application outcome', () => {
    const counters = emptyMonitoringCounters();
    recordListingDecisionMetric(counters, { flow: 'new', decision: 'stored' });
    recordListingDecisionMetric(counters, { flow: 'new', decision: 'sent', status: 'sent' });
    recordListingDecisionMetric(counters, { flow: 'new', decision: 'failed', status: 'failed' });
    recordListingDecisionMetric(counters, { flow: 'new', decision: 'failed', status: 'rejected' });
    recordListingDecisionMetric(counters, { flow: 'new', decision: 'failed', status: 'unknown' });
    expect(counters).toEqual({
      newListings: 1,
      providerConfirmed: 1,
      manualApplied: 0,
      retryableFailures: 1,
      terminalFailures: 1,
      unknownFailures: 1,
      notAttempted: 0,
    });
  });

  it('counts eligible new-flow skips as not attempted without re-counting repair passes', () => {
    const counters = emptyMonitoringCounters();
    recordListingDecisionMetric(counters, {
      flow: 'new',
      decision: 'skipped',
      reason: 'incomplete-applicant-profile',
    });
    recordListingDecisionMetric(counters, {
      flow: 'repair',
      decision: 'skipped',
      reason: 'incomplete-applicant-profile',
    });
    recordListingDecisionMetric(counters, {
      flow: 'new',
      decision: 'skipped',
      reason: 'delivery-already-reserved',
    });
    for (const reason of [
      'commute-unmatched-address-limit',
      'automatic-policy-disabled',
      'missing-applicant-profile',
    ]) {
      recordListingDecisionMetric(counters, { flow: 'new', decision: 'skipped', reason });
    }
    expect(counters.notAttempted).toBe(4);
  });

  it('normalizes untrusted stored values and adds all fields', () => {
    const total = emptyMonitoringCounters();
    addMonitoringCounters(total, { newListings: '2', manualApplied: 1.8, terminalFailures: -3 });
    expect(total.newListings).toBe(2);
    expect(total.manualApplied).toBe(1);
    expect(total.terminalFailures).toBe(0);
    expect(normalizeMonitoringCounters(null)).toEqual(emptyMonitoringCounters());
  });
});
