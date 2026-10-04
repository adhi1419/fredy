/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import logger from '../../../lib/services/logger.js';
import {
  LISTING_DECISION_PREFIX,
  listingDecisionEvent,
  logListingDecision,
} from '../../../lib/services/observability/listingDecisionLogger.js';

describe('listingDecisionLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a one-line JSON event with the stable decision fields', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});

    const event = logListingDecision({
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      listingId: 'listing-1',
      flow: 'new',
      decision: 'skipped',
      reason: 'commute-over-budget',
      action: 'exclude',
      status: 'blocked',
    });

    expect(event).toEqual({
      event: 'listing_decision',
      schemaVersion: 1,
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      listingId: 'listing-1',
      flow: 'new',
      decision: 'skipped',
      reason: 'commute-over-budget',
      action: 'exclude',
      status: 'blocked',
    });
    const line = info.mock.calls[0][0];
    expect(line.startsWith(LISTING_DECISION_PREFIX)).toBe(true);
    expect(JSON.parse(line.slice(LISTING_DECISION_PREFIX.length))).toEqual(event);
  });

  it('ignores payload and personal-data fields outside the event contract', () => {
    const event = listingDecisionEvent({
      jobId: 'job-1',
      providerId: 'provider',
      listingId: 'listing-1',
      flow: 'repair',
      decision: 'failed',
      reason: 'delivery-error',
      address: 'Private street 1',
      title: 'Private listing title',
      email: 'person@example.com',
      message: 'Private inquiry text',
      error: new Error('Provider payload'),
    });

    expect(Object.keys(event)).toEqual([
      'event',
      'schemaVersion',
      'jobId',
      'providerId',
      'listingId',
      'flow',
      'decision',
      'reason',
    ]);
    expect(JSON.stringify(event)).not.toMatch(/Private|person@example/);
  });
});
