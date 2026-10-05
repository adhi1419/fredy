/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  describeReconcileSummary,
  hasSubmittedInquiryEvidence,
  isInquiryActionMissed,
  needsCoordinateRepair,
  needsInquiryTextRepair,
  needsNotificationCompleteRepair,
  planIsNoop,
  planListingRepair,
  planReconcile,
} from '../../../lib/services/jobs/searchRepair.js';

const NOW = 1_000_000_000;
const SETTLE = 60_000;

/** A stored listing that is missing every repairable field. */
function brokenRow(overrides = {}) {
  return {
    id: 'listing-1',
    address: 'Somewhere 1, Berlin',
    latitude: null,
    longitude: null,
    inquiryMessage: null,
    inquirySendStatus: null,
    notificationComplete: 0,
    createdAt: NOW - SETTLE - 1,
    notifiedAt: NOW - 1,
    ...overrides,
  };
}

/** The same listing after a full repair pass — every field it looks at is filled. */
function repairedRow(overrides = {}) {
  return brokenRow({
    latitude: 52.5,
    longitude: 13.4,
    inquiryMessage: 'Dear landlord, …',
    notificationComplete: 1,
    inquirySendStatus: 'sent',
    ...overrides,
  });
}

describe('coordinate repair eligibility', () => {
  it('needs repair when unset or half-set', () => {
    expect(needsCoordinateRepair({ latitude: null, longitude: null })).toBe(true);
    expect(needsCoordinateRepair({ latitude: 52.5, longitude: null })).toBe(true);
  });
  it('treats the -1/-1 "found nothing" marker as a final answer', () => {
    expect(needsCoordinateRepair({ latitude: -1, longitude: -1 })).toBe(false);
  });
  it('never touches a valid coordinate', () => {
    expect(needsCoordinateRepair({ latitude: 52.5, longitude: 13.4 })).toBe(false);
  });
});

describe('inquiry-text repair respects submitted evidence', () => {
  it('fills a missing draft that was never submitted', () => {
    expect(needsInquiryTextRepair({ inquiryMessage: null, inquirySendStatus: null })).toBe(true);
  });
  it('never overwrites a draft behind submitted evidence', () => {
    expect(hasSubmittedInquiryEvidence({ inquirySendStatus: 'sent' })).toBe(true);
    expect(hasSubmittedInquiryEvidence({ inquirySendStatus: 'sending' })).toBe(true);
    expect(hasSubmittedInquiryEvidence({ inquirySendStatus: 'unknown' })).toBe(true);
    expect(needsInquiryTextRepair({ inquiryMessage: null, inquirySendStatus: 'sent' })).toBe(false);
  });
  it('leaves an existing draft alone', () => {
    expect(needsInquiryTextRepair({ inquiryMessage: 'hello', inquirySendStatus: null })).toBe(false);
  });
});

describe('notification-complete repair from durable evidence', () => {
  it('fills once only when a durable notified timestamp exists', () => {
    expect(needsNotificationCompleteRepair(brokenRow())).toBe(true);
  });
  it('never flips a row that is already flagged', () => {
    expect(needsNotificationCompleteRepair({ notificationComplete: 1, notifiedAt: NOW })).toBe(false);
  });
  it('never treats row age as notification evidence', () => {
    expect(needsNotificationCompleteRepair(brokenRow({ notifiedAt: null, createdAt: 0 }))).toBe(false);
  });
});

describe('missed external action eligibility', () => {
  it('is missed only when explicitly failed before a provider side effect', () => {
    expect(isInquiryActionMissed({ inquirySendStatus: null })).toBe(false);
    expect(isInquiryActionMissed({ inquirySendStatus: 'failed' })).toBe(true);
  });
  it('is not missed for sent / sending / unknown / rejected', () => {
    expect(isInquiryActionMissed({ inquirySendStatus: 'sent' })).toBe(false);
    expect(isInquiryActionMissed({ inquirySendStatus: 'sending' })).toBe(false);
    expect(isInquiryActionMissed({ inquirySendStatus: 'unknown' })).toBe(false);
    expect(isInquiryActionMissed({ inquirySendStatus: 'rejected' })).toBe(false);
  });
});

describe('planListingRepair', () => {
  it('plans every field on a broken row when the job may auto-act', () => {
    const plan = planListingRepair(brokenRow({ inquirySendStatus: 'failed' }), {
      now: NOW,
      settleMs: SETTLE,
      autoActEligible: true,
    });
    expect(plan.repairs).toEqual({ coordinates: true, inquiryText: true, notificationComplete: true });
    expect(plan.missedAction).toEqual({ kind: 'inquiry' });
    expect(plan.manualReview).toBeNull();
  });

  it('never offers the external action on a job that does not auto-act', () => {
    const plan = planListingRepair(brokenRow(), { now: NOW, settleMs: SETTLE, autoActEligible: false });
    expect(plan.missedAction).toBeNull();
    // Field repair is still planned — only the side-effecting action is withheld.
    expect(plan.repairs.coordinates).toBe(true);
  });

  it('routes an unknown inquiry outcome to manual review and never resends it', () => {
    const plan = planListingRepair(brokenRow({ inquirySendStatus: 'unknown' }), {
      now: NOW,
      settleMs: SETTLE,
      autoActEligible: true,
    });
    expect(plan.manualReview).toEqual({ reason: 'inquiry-outcome-unknown' });
    expect(plan.missedAction).toBeNull();
  });
});

describe('planReconcile idempotency — the core guarantee', () => {
  it('plans work on the first pass and NOTHING on the second', () => {
    const first = planReconcile([brokenRow({ inquirySendStatus: 'failed' })], {
      now: NOW,
      settleMs: SETTLE,
      autoActEligible: true,
    });
    expect(planIsNoop(first)).toBe(false);
    expect(first.summary).toMatchObject({
      scanned: 1,
      coordinatesRepaired: 1,
      inquiryTextRepaired: 1,
      notificationCompleteRepaired: 1,
      missedActions: 1,
    });

    // The repaired row is what the second pass sees. It must plan nothing at all.
    const second = planReconcile([repairedRow()], { now: NOW, settleMs: SETTLE, autoActEligible: true });
    expect(planIsNoop(second)).toBe(true);
    expect(second.summary).toMatchObject({
      coordinatesRepaired: 0,
      inquiryTextRepaired: 0,
      notificationCompleteRepaired: 0,
      missedActions: 0,
    });
  });

  it('performs exactly one safely-missed action across a mixed batch', () => {
    const rows = [
      brokenRow({ id: 'a', inquirySendStatus: 'failed' }), // explicit failure → one retry
      repairedRow({ id: 'b' }), // fully healthy → nothing
      brokenRow({ id: 'c', inquirySendStatus: 'unknown' }), // unknown → manual review, no send
      brokenRow({ id: 'd', inquirySendStatus: null }), // no attempt → no retry
    ];
    const { summary } = planReconcile(rows, { now: NOW, settleMs: SETTLE, autoActEligible: true });
    expect(summary.missedActions).toBe(1);
    expect(summary.manualReview).toBe(1);
  });
});

describe('describeReconcileSummary', () => {
  it('is plain language and mentions manual review when present', () => {
    const { summary } = planReconcile([brokenRow(), brokenRow({ id: 'x', inquirySendStatus: 'unknown' })], {
      now: NOW,
      settleMs: SETTLE,
      autoActEligible: true,
    });
    const text = describeReconcileSummary(summary);
    expect(text).toContain('Reconciled');
    expect(text).toContain('manual review');
  });

  it('says nothing-to-do when there are no stored listings', () => {
    expect(describeReconcileSummary(planReconcile([]).summary)).toContain('no stored listings');
  });
});
