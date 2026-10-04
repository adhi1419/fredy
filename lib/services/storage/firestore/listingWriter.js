/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

function numericAffinity(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

const nullOrEmpty = (value) => value == null || String(value).trim().length === 0;

function removeParentheses(value) {
  if (nullOrEmpty(value)) return null;
  return String(value).replace(/\s*\([^)]*\)/g, '');
}

/**
 * Convert an incoming ParsedListing into the canonical Firestore document.
 *
 * Optional fields are written deliberately, rather than omitted, so all new rows
 * have the same schema. `status` is intentionally absent: lifecycle is the sole
 * canonical user-visible state.
 *
 * @param {string} jobId
 * @param {string} providerId
 * @param {Object} listing
 * @param {number} [createdAt]
 * @returns {Object}
 */
export function toFirestoreListing(jobId, providerId, listing, createdAt = Date.now()) {
  return {
    hash: listing.id,
    provider: providerId,
    jobId,
    price: numericAffinity(listing.price),
    size: numericAffinity(listing.size),
    rooms: numericAffinity(listing.rooms),
    buildYear: listing.buildYear ?? null,
    energyClass: listing.energyClass ?? null,
    title: listing.title ?? null,
    imageUrl: listing.image ?? null,
    description: listing.description ?? null,
    address: removeParentheses(listing.address),
    link: listing.link ?? null,
    createdAt,
    isActive: true,
    manuallyDeleted: false,
    latitude: listing.latitude ?? null,
    longitude: listing.longitude ?? null,
    distances: null,
    notes: null,
    inquiryMessage: listing.inquiryMessage ?? null,
    inquirySendStatus: listing.inquirySendStatus ?? null,
    inquirySendStartedAt: listing.inquirySendStartedAt ?? null,
    inquirySentAt: listing.inquirySentAt ?? null,
    inquirySendError: listing.inquirySendError ?? null,
    inquiryRequestId: listing.inquiryRequestId ?? null,
    notificationComplete: false,
    notifiedAt: null,
    inactiveSince: null,
    activeCheckFailures: 0,
    lastCheckedAt: null,
    travelTimeFailures: 0,
    travelTimesAt: null,
    connectivityCheckedAt: null,
    lifecycle: {
      state: 'new',
      source: null,
      changedAt: createdAt,
      changedBy: null,
      appliedAt: null,
      viewedAt: null,
    },
  };
}
