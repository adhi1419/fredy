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
  it('reads only matching non-deleted known listings', async () => {
    firestore.seed('listings', 'match', { jobId: 'job-1', provider: 'provider-1', hash: 'h1' });
    firestore.seed('listings', 'other-provider', { jobId: 'job-1', provider: 'provider-2', hash: 'h2' });
    firestore.seed('listings', 'deleted', {
      jobId: 'job-1',
      provider: 'provider-1',
      hash: 'h3',
      manuallyDeleted: true,
    });

    await expect(storage.getKnownListingsForRepair('job-1', 'provider-1')).resolves.toEqual([
      expect.objectContaining({ id: 'match', hash: 'h1' }),
    ]);
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
