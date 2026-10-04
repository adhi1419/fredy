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
const index = await import('../../../lib/services/storage/firestore/knownListingIndex.js');
const { listingDocId } = await import('../../../lib/services/storage/firestore/collections.js');

const row = (jobId, hash, extra = {}) => ({
  jobId,
  hash,
  provider: 'provider-1',
  manuallyDeleted: false,
  isActive: true,
  title: `Home ${hash}`,
  ...extra,
});

beforeEach(() => {
  firestore.clear();
  index.resetKnownListingIndex();
});

describe('known-listing index', () => {
  it('reports every hash as unconfirmed before the first full load', () => {
    expect(index.partitionKnownHashes('job-1', ['a', 'b'])).toEqual({ known: [], unconfirmed: ['a', 'b'] });
  });

  it('is loaded by the first full read, tombstones included, and returns only live entries', async () => {
    firestore.seed('listings', listingDocId('job-1', 'live'), row('job-1', 'live'));
    firestore.seed('listings', listingDocId('job-1', 'gone'), row('job-1', 'gone', { manuallyDeleted: true }));

    const entries = await storage.getAllEntriesFromListings();
    expect(entries.map((entry) => entry.title)).toEqual(['Home live']);
    expect(index.isKnownListingIndexLoaded()).toBe(true);
    expect(index.partitionKnownHashes('job-1', ['live', 'gone', 'new'])).toEqual({
      known: ['live', 'gone'],
      unconfirmed: ['new'],
    });
  });

  it('answers index hits even when Firestore no longer holds the row, proving no read was made', async () => {
    firestore.seed('listings', listingDocId('job-1', 'live'), row('job-1', 'live'));
    await storage.getAllEntriesFromListings();
    // Remove the row behind the index's back: a query would now miss it.
    firestore.clear();

    await expect(storage.findKnownHashes('job-1', 'provider-1', ['live'])).resolves.toEqual(['live']);
  });

  it('confirms misses in Firestore and remembers what it found', async () => {
    await storage.getAllEntriesFromListings();
    // Stored by another instance after the load.
    firestore.seed('listings', listingDocId('job-1', 'late'), row('job-1', 'late'));

    await expect(storage.findKnownHashes('job-1', 'provider-1', ['late', 'new'])).resolves.toEqual(['late']);
    expect(index.partitionKnownHashes('job-1', ['late']).known).toEqual(['late']);
  });

  it('learns stored listings and forgets hard-deleted ones', async () => {
    await storage.getAllEntriesFromListings();
    const listing = { id: 'fresh', title: 'Fresh' };
    await storage.storeListings('job-1', 'provider-1', [listing]);
    expect(index.partitionKnownHashes('job-1', ['fresh']).known).toEqual(['fresh']);

    await storage.deleteListingsById([listing.id], true);
    expect(index.partitionKnownHashes('job-1', ['fresh'])).toEqual({ known: [], unconfirmed: ['fresh'] });
  });

  it('keeps the loaded index when later reloads read live rows only', async () => {
    firestore.seed('listings', listingDocId('job-1', 'gone'), row('job-1', 'gone', { manuallyDeleted: true }));
    await storage.getAllEntriesFromListings();
    await storage.getAllEntriesFromListings();
    expect(index.partitionKnownHashes('job-1', ['gone']).known).toEqual(['gone']);
  });
});
