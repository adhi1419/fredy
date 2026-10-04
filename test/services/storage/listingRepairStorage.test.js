/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();
vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const storage = await import('../../../lib/services/storage/listingsStorage.js');

beforeEach(() => firestore.clear());

describe('listing repair storage seams', () => {
  const healthy = {
    provider: 'provider-1',
    manuallyDeleted: false,
    isActive: true,
    title: 'Active home',
    price: 900,
    size: 60,
    rooms: 2,
    description: 'Provider details',
    address: 'Somewhere 1, Berlin',
    link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/home-89-1471120007',
    notificationComplete: true,
    inquirySendStatus: 'sent',
    inquiryMessage: 'Hello',
    latitude: 52.5,
    longitude: 13.4,
  };

  it('returns only broken rows of this job and provider, in camelCase', async () => {
    firestore.seed('listings', 'healthy', { ...healthy, jobId: 'job-1', hash: 'h0' });
    firestore.seed('listings', 'no-notify', {
      ...healthy,
      jobId: 'job-1',
      hash: 'h1',
      notificationComplete: false,
      notifiedAt: 1,
    });
    firestore.seed('listings', 'never-notified', {
      ...healthy,
      jobId: 'job-1',
      hash: 'h11',
      notificationComplete: false,
      notifiedAt: null,
    });
    firestore.seed('listings', 'failed', { ...healthy, jobId: 'job-1', hash: 'h2', inquirySendStatus: 'failed' });
    firestore.seed('listings', 'never-sent', { ...healthy, jobId: 'job-1', hash: 'h3', inquirySendStatus: null });
    firestore.seed('listings', 'no-draft', { ...healthy, jobId: 'job-1', hash: 'h4', inquiryMessage: null });
    firestore.seed('listings', 'no-coords', { ...healthy, jobId: 'job-1', hash: 'h5', latitude: null });
    firestore.seed('listings', 'not-found', { ...healthy, jobId: 'job-1', hash: 'h6', latitude: -1 });
    firestore.seed('listings', 'rejected', { ...healthy, jobId: 'job-1', hash: 'h7', inquirySendStatus: 'rejected' });
    firestore.seed('listings', 'other-job', { ...healthy, jobId: 'job-2', hash: 'h8', latitude: null });
    firestore.seed('listings', 'other-provider', {
      ...healthy,
      jobId: 'job-1',
      provider: 'provider-2',
      hash: 'h9',
      latitude: null,
    });
    firestore.seed('listings', 'inactive', {
      ...healthy,
      jobId: 'job-1',
      hash: 'h-inactive',
      isActive: false,
      inquirySendStatus: null,
    });
    firestore.seed('listings', 'deleted', {
      ...healthy,
      jobId: 'job-1',
      hash: 'h10',
      manuallyDeleted: true,
      latitude: null,
    });

    const rows = await storage.getListingsNeedingRepair('job-1', 'provider-1', { inquiries: true, drafts: true });
    expect(rows.map((row) => row.id).sort()).toEqual([
      'failed',
      'never-sent',
      'no-coords',
      'no-draft',
      'no-notify',
      'not-found',
    ]);
    expect(rows.find((row) => row.id === 'failed')).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        inquirySendStatus: 'failed',
        notificationComplete: true,
        isActive: true,
        title: 'Active home',
        link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/home-89-1471120007',
      }),
    );

    // Without an automatic source or a message generator, those categories are not even queried.
    const localOnly = await storage.getListingsNeedingRepair('job-1', 'provider-1');
    expect(localOnly.map((row) => row.id).sort()).toEqual(['no-coords', 'no-notify', 'not-found']);
  });

  it('reads no healthy rows', async () => {
    for (let i = 0; i < 20; i += 1) {
      firestore.seed('listings', `healthy-${i}`, { ...healthy, jobId: 'job-1', hash: `h${i}` });
    }
    await expect(storage.getListingsNeedingRepair('job-1', 'provider-1')).resolves.toEqual([]);
  });

  it('finds only requested hashes and does not read unrelated candidates', async () => {
    firestore.seed('listings', 'h1-row', { jobId: 'job-1', provider: 'provider-1', hash: 'h1' });
    firestore.seed('listings', 'h2-row', { jobId: 'job-1', provider: 'provider-1', hash: 'h2' });
    firestore.seed('listings', 'other-row', { jobId: 'job-1', provider: 'provider-2', hash: 'h3' });

    await expect(storage.findKnownHashes('job-1', 'provider-1', ['h2', 'h2', 'missing'])).resolves.toEqual(['h2']);
  });
  it('repairs missing coordinates once and preserves valid provider coordinates', async () => {
    firestore.seed('listings', 'missing', { latitude: null, longitude: null });
    firestore.seed('listings', 'located', { latitude: 52.5, longitude: 13.4 });

    await expect(storage.repairListingCoordinates('missing', { lat: 51.2, lng: 6.8 })).resolves.toBe(1);
    await expect(storage.repairListingCoordinates('missing', { lat: 51.2, lng: 6.8 })).resolves.toBe(0);
    await expect(storage.repairListingCoordinates('located', { lat: 1, lng: 2 })).resolves.toBe(0);
    expect(firestore.read('listings', 'missing')).toMatchObject({ latitude: 51.2, longitude: 6.8 });
    expect(firestore.read('listings', 'located')).toMatchObject({ latitude: 52.5, longitude: 13.4 });
  });

  it('marks notification completion once with durable evidence', async () => {
    firestore.seed('listings', 'listing-1', { notificationComplete: false });

    await expect(storage.markNotificationComplete('listing-1', 1234)).resolves.toBe(1);
    await expect(storage.markNotificationComplete('listing-1', 9999)).resolves.toBe(0);
    expect(firestore.read('listings', 'listing-1')).toMatchObject({ notificationComplete: true, notifiedAt: 1234 });
  });
});
