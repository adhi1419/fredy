/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * searchRepair — reconcile + safely-act pass for a Saved Search run.
 *
 * A manual or scheduled run scrapes the provider and notifies about genuinely new listings.
 * Anything already stored is skipped by the hash tombstone in FredyPipelineExecutioner._findNew,
 * which is exactly what stops a second run re-notifying — but that same tombstone also means a
 * listing that was stored with a HALF-DONE state (never geocoded, no drafted inquiry text, a
 * notification that never completed, an external action that failed before its side effect) is
 * never looked at again.
 *
 * This module reconciles the KNOWN listings — the ones _findNew drops — by their stable
 * job/provider/hash identity, and computes a field-scoped repair plan plus the set of external
 * actions that are safe to (re)attempt. It is intentionally pure: it reads rows and returns a
 * plan. The caller (executioner / API route) applies the plan through the existing storage and
 * inquiry-delivery seams, so the durable idempotency guarantees (reserveInquirySend) are the ones
 * already proven by the inquiry-delivery contract.
 *
 * The defining property is that a repair is a no-op on a healthy row: run it twice and the second
 * pass plans nothing, because the first pass filled exactly the fields it looks at.
 */

/** @import { ParsedListing } from '../../types/listing.js' */

/**
 * A repaired coordinate is only planned when the stored one is absent, half-present, or the
 * `-1/-1` "geocoder found nothing" marker. A valid coordinate is never touched — a provider that
 * reads a JSON API often has metre-accurate coordinates that a re-geocode from address text would
 * make worse.
 *
 * @param {{ latitude?: number|null, longitude?: number|null }} row
 * @returns {boolean}
 */
export function needsCoordinateRepair(row) {
  const { latitude, longitude } = row;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return true;
  }
  return latitude === -1 && longitude === -1;
}

/**
 * Whether a listing carries the durable evidence that its inquiry was actually submitted.
 * Submitted evidence is a `sent`/`sending`/`unknown` send-status: any of these means Fredy has
 * already spoken to the provider (or is mid-flight), and the drafted text that produced that
 * request must never be overwritten. Only `failed` and the absence of any status are open.
 *
 * @param {{ inquiry_send_status?: string|null }} row
 * @returns {boolean}
 */
export function hasSubmittedInquiryEvidence(row) {
  const status = row.inquiry_send_status ?? row.inquirySendStatus ?? null;
  return status === 'sent' || status === 'sending' || status === 'unknown';
}

/**
 * Whether the deterministic inquiry draft should be (re)filled.
 * Only when the row has no stored draft AND no submitted evidence. A row that already carries a
 * draft, or that has been submitted, is left exactly as it is — the second run plans nothing.
 *
 * @param {{ inquiry_message?: string|null }} row
 * @returns {boolean}
 */
export function needsInquiryTextRepair(row) {
  if (hasSubmittedInquiryEvidence(row)) return false;
  const draft = row.inquiry_message ?? row.inquiryMessage ?? null;
  return draft == null || String(draft).trim().length === 0;
}

/**
 * Whether the notification-complete boolean can be repaired from durable delivery evidence.
 * Row age is never evidence: the process may have stopped after storage and before notification.
 * Only an existing notified timestamp may reconcile a missing boolean; otherwise the row remains
 * incomplete rather than claiming a notification that might never have happened.
 *
 * @param {{ notification_complete?: boolean|number|null, notified_at?: number|null }} row
 * @returns {boolean}
 */
export function needsNotificationCompleteRepair(row) {
  const flag = row.notification_complete ?? row.notificationComplete ?? null;
  if (flag === true || flag === 1) return false;
  const notifiedAt = row.notified_at ?? row.notifiedAt ?? null;
  return typeof notifiedAt === 'number' && Number.isFinite(notifiedAt);
}

/**
 * Whether a previously-missed external inquiry action may be (re)attempted.
 *
 * This is the ONE place the run is allowed to do something with a side effect on a KNOWN listing,
 * and it is deliberately narrow. Eligible only when the action was:
 *   - never attempted (no send status at all), or
 *   - explicitly `failed` before any side effect.
 * In both cases the durable barrier is `reserveInquirySend`, which the caller still goes through,
 * so a race or a concurrent run cannot double-send.
 *
 * `sent` and `sending` are done or in-flight and are never re-attempted. `unknown` is the crucial
 * case: the provider may already have received the request, so it is NOT treated as missed — it
 * stays for manual review and is never blindly resent.
 *
 * @param {{ inquiry_send_status?: string|null }} row
 * @returns {boolean}
 */
export function isInquiryActionMissed(row) {
  const status = row.inquiry_send_status ?? row.inquirySendStatus ?? null;
  return status == null || status === 'failed';
}

/**
 * Build the repair plan for a single known listing row.
 *
 * @param {Object} row API-row shaped listing (snake_case), already scoped to the job+provider.
 * @param {{ autoActEligible?: boolean }} [options]
 *   `autoActEligible` mirrors the job's own automatic-inquiry policy: field repair is always
 *   allowed, but the external action is only offered on jobs that would have sent automatically.
 * @returns {{
 *   id: string,
 *   repairs: { coordinates: boolean, inquiryText: boolean, notificationComplete: boolean },
 *   missedAction: { kind: 'inquiry' } | null,
 *   manualReview: { reason: string } | null,
 * }}
 */
export function planListingRepair(row, { autoActEligible = false } = {}) {
  const repairs = {
    coordinates: Boolean(row.address) && needsCoordinateRepair(row),
    inquiryText: needsInquiryTextRepair(row),
    notificationComplete: needsNotificationCompleteRepair(row),
  };

  const status = row.inquiry_send_status ?? row.inquirySendStatus ?? null;
  // `unknown` is the outcome that must never be auto-resolved: flag it for a human, never resend.
  const manualReview = status === 'unknown' ? { reason: 'inquiry-outcome-unknown' } : null;

  const missedAction =
    autoActEligible && manualReview == null && isInquiryActionMissed(row) ? { kind: 'inquiry' } : null;

  return { id: row.id, repairs, missedAction, manualReview };
}

/**
 * Build the plan for every known listing of a job+provider.
 *
 * @param {Object[]} rows
 * @param {{ autoActEligible?: boolean }} [options]
 * @returns {{
 *   plans: ReturnType<typeof planListingRepair>[],
 *   summary: {
 *     scanned: number,
 *     coordinatesRepaired: number,
 *     inquiryTextRepaired: number,
 *     notificationCompleteRepaired: number,
 *     missedActions: number,
 *     manualReview: number,
 *   },
 * }}
 */
export function planReconcile(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const plans = list.map((row) => planListingRepair(row, options));
  const summary = {
    scanned: plans.length,
    coordinatesRepaired: plans.filter((p) => p.repairs.coordinates).length,
    inquiryTextRepaired: plans.filter((p) => p.repairs.inquiryText).length,
    notificationCompleteRepaired: plans.filter((p) => p.repairs.notificationComplete).length,
    missedActions: plans.filter((p) => p.missedAction != null).length,
    manualReview: plans.filter((p) => p.manualReview != null).length,
  };
  return { plans, summary };
}

/**
 * Whether a plan would change anything at all — the idempotency oracle a caller (and a test) can
 * assert directly: a second reconcile over rows the first one repaired returns `false` here.
 *
 * @param {ReturnType<typeof planReconcile>} plan
 * @returns {boolean}
 */
export function planIsNoop(plan) {
  const s = plan?.summary;
  if (s == null) return true;
  return (
    s.coordinatesRepaired === 0 &&
    s.inquiryTextRepaired === 0 &&
    s.notificationCompleteRepaired === 0 &&
    s.missedActions === 0
  );
}

/**
 * A plain-language, translation-free summary of what a reconcile pass did or would do.
 * The API route localizes the headline; this string is the operator/log-facing fallback.
 *
 * @param {ReturnType<typeof planReconcile>['summary']} summary
 * @returns {string}
 */
export function describeReconcileSummary(summary) {
  if (summary == null || summary.scanned === 0) {
    return 'Nothing to reconcile: this search has no stored listings yet.';
  }
  const parts = [];
  if (summary.coordinatesRepaired > 0) parts.push(`${summary.coordinatesRepaired} location(s) filled in`);
  if (summary.inquiryTextRepaired > 0) parts.push(`${summary.inquiryTextRepaired} inquiry draft(s) restored`);
  if (summary.notificationCompleteRepaired > 0)
    parts.push(`${summary.notificationCompleteRepaired} notification record(s) reconciled`);
  if (summary.missedActions > 0) parts.push(`${summary.missedActions} missed action(s) retried`);
  const review = summary.manualReview > 0 ? ` ${summary.manualReview} left for manual review.` : '';
  if (parts.length === 0) {
    return `Everything is already in order across ${summary.scanned} listing(s).${review}`;
  }
  return `Reconciled ${summary.scanned} listing(s): ${parts.join(', ')}.${review}`;
}
