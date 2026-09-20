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
    inquiry_message: null,
    inquiry_send_status: null,
    notification_complete: 0,
    created_at: NOW - SETTLE - 1,
    notified_at: NOW - 1,
    ...overrides,
  };
}

/** The same listing after a full repair pass — every field it looks at is filled. */
function repairedRow(overrides = {}) {
  return brokenRow({
    latitude: 52.5,
    longitude: 13.4,
    inquiry_message: 'Dear landlord, …',
    notification_complete: 1,
    inquiry_send_status: 'sent',
    ...overrides,
  });
}

describe('coordinate repair eligibility', () => {
  it('needs repair when unset or half-set', () => {
    expect(needsCoordinateRepair({ latitude: null, longitude: null })).toBe(true);
    expect(needsCoordinateRepair({ latitude: 52.5, longitude: null })).toBe(true);
  });
  it('needs repair on the -1/-1 "found nothing" marker', () => {
    expect(needsCoordinateRepair({ latitude: -1, longitude: -1 })).toBe(true);
  });
  it('never touches a valid coordinate', () => {
    expect(needsCoordinateRepair({ latitude: 52.5, longitude: 13.4 })).toBe(false);
  });
});

describe('inquiry-text repair respects submitted evidence', () => {
  it('fills a missing draft that was never submitted', () => {
    expect(needsInquiryTextRepair({ inquiry_message: null, inquiry_send_status: null })).toBe(true);
  });
  it('never overwrites a draft behind submitted evidence', () => {
    expect(hasSubmittedInquiryEvidence({ inquiry_send_status: 'sent' })).toBe(true);
    expect(hasSubmittedInquiryEvidence({ inquiry_send_status: 'sending' })).toBe(true);
    expect(hasSubmittedInquiryEvidence({ inquiry_send_status: 'unknown' })).toBe(true);
    expect(needsInquiryTextRepair({ inquiry_message: null, inquiry_send_status: 'sent' })).toBe(false);
  });
  it('leaves an existing draft alone', () => {
    expect(needsInquiryTextRepair({ inquiry_message: 'hello', inquiry_send_status: null })).toBe(false);
  });
});

describe('notification-complete repair from durable evidence', () => {
  it('fills once only when a durable notified timestamp exists', () => {
    expect(needsNotificationCompleteRepair(brokenRow())).toBe(true);
  });
  it('never flips a row that is already flagged', () => {
    expect(needsNotificationCompleteRepair({ notification_complete: 1, notified_at: NOW })).toBe(false);
  });
  it('never treats row age as notification evidence', () => {
    expect(needsNotificationCompleteRepair(brokenRow({ notified_at: null, created_at: 0 }))).toBe(false);
  });
});

describe('missed external action eligibility', () => {
  it('is missed only when never attempted or explicitly failed', () => {
    expect(isInquiryActionMissed({ inquiry_send_status: null })).toBe(true);
    expect(isInquiryActionMissed({ inquiry_send_status: 'failed' })).toBe(true);
  });
  it('is not missed for sent / sending / unknown', () => {
    expect(isInquiryActionMissed({ inquiry_send_status: 'sent' })).toBe(false);
    expect(isInquiryActionMissed({ inquiry_send_status: 'sending' })).toBe(false);
    expect(isInquiryActionMissed({ inquiry_send_status: 'unknown' })).toBe(false);
  });
});

describe('planListingRepair', () => {
  it('plans every field on a broken row when the job may auto-act', () => {
    const plan = planListingRepair(brokenRow(), { now: NOW, settleMs: SETTLE, autoActEligible: true });
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
    const plan = planListingRepair(brokenRow({ inquiry_send_status: 'unknown' }), {
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
    const first = planReconcile([brokenRow()], { now: NOW, settleMs: SETTLE, autoActEligible: true });
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
      brokenRow({ id: 'a' }), // never attempted → one missed action
      repairedRow({ id: 'b' }), // fully healthy → nothing
      brokenRow({ id: 'c', inquiry_send_status: 'unknown' }), // unknown → manual review, no send
    ];
    const { summary } = planReconcile(rows, { now: NOW, settleMs: SETTLE, autoActEligible: true });
    expect(summary.missedActions).toBe(1);
    expect(summary.manualReview).toBe(1);
  });
});

describe('describeReconcileSummary', () => {
  it('is plain language and mentions manual review when present', () => {
    const { summary } = planReconcile([brokenRow(), brokenRow({ id: 'x', inquiry_send_status: 'unknown' })], {
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
