/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { toFirestoreListing } from '../../../lib/services/storage/firestore/listingWriter.js';

const listing = {
  id: 'hash-1',
  price: '1200',
  size: '42',
  rooms: '2',
  buildYear: undefined,
  energyClass: undefined,
  title: 'Flat',
  image: undefined,
  description: undefined,
  address: 'Main 1 (district)',
  link: 'https://example.test/1',
  latitude: 52.5,
  longitude: 13.4,
};

const expectedKeys = [
  'activeCheckFailures',
  'address',
  'buildYear',
  'connectivityCheckedAt',
  'createdAt',
  'description',
  'distances',
  'energyClass',
  'hash',
  'imageUrl',
  'inactiveSince',
  'inquiryMessage',
  'inquiryRequestId',
  'inquirySendError',
  'inquirySendStartedAt',
  'inquirySendStatus',
  'inquirySentAt',
  'isActive',
  'jobId',
  'lastCheckedAt',
  'latitude',
  'lifecycle',
  'link',
  'longitude',
  'manuallyDeleted',
  'notes',
  'notificationComplete',
  'notifiedAt',
  'price',
  'provider',
  'rooms',
  'size',
  'title',
  'travelTimeFailures',
  'travelTimesAt',
].sort();

describe('toFirestoreListing', () => {
  it('writes the canonical key set and explicit optional defaults', () => {
    const row = toFirestoreListing('job-1', 'provider-1', listing, 1234);

    expect(Object.keys(row).sort()).toEqual(expectedKeys);
    expect(row).not.toHaveProperty('status');
    expect(row).toMatchObject({
      hash: 'hash-1',
      provider: 'provider-1',
      jobId: 'job-1',
      price: 1200,
      size: 42,
      rooms: 2,
      address: 'Main 1',
      createdAt: 1234,
      notificationComplete: false,
      activeCheckFailures: 0,
      travelTimeFailures: 0,
      lifecycle: {
        state: 'new',
        source: null,
        changedAt: 1234,
        changedBy: null,
        appliedAt: null,
        viewedAt: null,
      },
    });
    expect(row.inquiryMessage).toBeNull();
    expect(row.connectivityCheckedAt).toBeNull();
  });
});
