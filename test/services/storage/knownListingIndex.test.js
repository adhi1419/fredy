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
const jobStorage = await import('../../../lib/services/storage/firestore/jobStorage.js');
const index = await import('../../../lib/services/storage/firestore/knownListingIndex.js');
const { listingDocId } = await import('../../../lib/services/storage/firestore/collections.js');
const { MANIFEST_SHARD_COUNT, manifestDocId, manifestShardForListingId } =
  await import('../../../lib/services/storage/firestore/knownListingManifest.js');

const row = (jobId, hash, extra = {}) => ({
  jobId,
  hash,
  provider: 'provider-1',
  manuallyDeleted: false,
  isActive: true,
  title: `Home ${hash}`,
  ...extra,
});

const seedManifest = (ids = []) => {
  const idsByShard = new Map([...Array(MANIFEST_SHARD_COUNT)].map((_, index) => [index.toString(16), []]));
  for (const id of ids) idsByShard.get(manifestShardForListingId(id)).push(id);
  for (const [shard, knownListingIds] of idsByShard) {
    firestore.seed('_known_listing_manifests', manifestDocId(shard), { knownListingIds });
  }
};

beforeEach(() => {
  firestore.clear();
  index.resetKnownListingIndex();
});

describe('known-listing index', () => {
  it('reports every hash as unconfirmed before the first full load', () => {
    expect(index.partitionKnownHashes('job-1', ['a', 'b'])).toEqual({ known: [], unconfirmed: ['a', 'b'] });
  });

  it('loads a complete manifest, tombstones included, and returns only live entries', async () => {
    const liveId = listingDocId('job-1', 'live');
    const goneId = listingDocId('job-1', 'gone');
    seedManifest([liveId, goneId]);
    firestore.seed('listings', liveId, row('job-1', 'live'));
    firestore.seed('listings', goneId, row('job-1', 'gone', { manuallyDeleted: true }));

    const entries = await storage.getAllEntriesFromListings();
    expect(entries.map((entry) => entry.title)).toEqual(['Home live']);
    expect(index.isKnownListingIndexLoaded()).toBe(true);
    expect(index.partitionKnownHashes('job-1', ['live', 'gone', 'new'])).toEqual({
      known: ['live', 'gone'],
      unconfirmed: ['new'],
    });
  });

  it('answers index hits even when Firestore no longer holds the row, proving no read was made', async () => {
    const liveId = listingDocId('job-1', 'live');
    seedManifest([liveId]);
    firestore.seed('listings', liveId, row('job-1', 'live'));
    await storage.getAllEntriesFromListings();
    // Remove the row behind the index's back: a query would now miss it.
    firestore.clear();

    await expect(storage.findKnownHashes('job-1', 'provider-1', ['live'])).resolves.toEqual(['live']);
  });

  it('confirms misses in Firestore and remembers what it found', async () => {
    seedManifest();
    await storage.getAllEntriesFromListings();
    // Stored by another instance after the load.
    firestore.seed('listings', listingDocId('job-1', 'late'), row('job-1', 'late'));

    await expect(storage.findKnownHashes('job-1', 'provider-1', ['late', 'new'])).resolves.toEqual(['late']);
    expect(index.partitionKnownHashes('job-1', ['late']).known).toEqual(['late']);
  });

  it('learns stored listings and forgets hard-deleted ones', async () => {
    seedManifest();
    await storage.getAllEntriesFromListings();
    const listing = { id: 'fresh', title: 'Fresh' };
    await storage.storeListings('job-1', 'provider-1', [listing]);
    expect(index.partitionKnownHashes('job-1', ['fresh']).known).toEqual(['fresh']);

    await storage.deleteListingsById([listing.id], true);
    expect(index.partitionKnownHashes('job-1', ['fresh'])).toEqual({ known: [], unconfirmed: ['fresh'] });
  });

  it('keeps the loaded index when later reloads read live rows only', async () => {
    const goneId = listingDocId('job-1', 'gone');
    seedManifest([goneId]);
    firestore.seed('listings', goneId, row('job-1', 'gone', { manuallyDeleted: true }));
    await storage.getAllEntriesFromListings();
    await storage.getAllEntriesFromListings();
    expect(index.partitionKnownHashes('job-1', ['gone']).known).toEqual(['gone']);
  });

  it('loads exact tombstones from persisted shards while hydrating only live rows', async () => {
    const liveId = listingDocId('job-1', 'live');
    const tombstoneId = listingDocId('job-1', 'gone');
    seedManifest([liveId, tombstoneId]);
    firestore.seed('listings', liveId, row('job-1', 'live'));
    firestore.seed('listings', tombstoneId, row('job-1', 'gone', { manuallyDeleted: true }));

    await expect(storage.getAllEntriesFromListings()).resolves.toEqual([
      {
        job_id: 'job-1',
        provider: 'provider-1',
        title: 'Home live',
        address: null,
        price: null,
        size: null,
        rooms: null,
        description: null,
      },
    ]);
    expect(index.partitionKnownHashes('job-1', ['live', 'gone', 'new'])).toEqual({
      known: ['live', 'gone'],
      unconfirmed: ['new'],
    });
  });

  it('persists a batch once per affected shard and removes direct and job-cascade hard deletes', async () => {
    const items = [
      { id: 'direct', title: 'Direct' },
      { id: 'cascade', title: 'Cascade' },
    ];
    seedManifest();
    await storage.storeListings('job-1', 'provider-1', items);
    const manifestIds = firestore
      .list('_known_listing_manifests')
      .flatMap((manifest) => manifest.knownListingIds ?? []);
    expect(manifestIds.sort()).toEqual(items.map((item) => item.id).sort());

    await storage.deleteListingsById([items[0].id], true);
    await jobStorage.deleteListingsCascadeByJobId('job-1');
    index.resetKnownListingIndex();
    await storage.getAllEntriesFromListings();
    await expect(storage.findKnownHashes('job-1', 'provider-1', ['direct', 'cascade'])).resolves.toEqual([]);
  });

  it('fails closed when any expected manifest shard is missing', async () => {
    const liveId = listingDocId('job-1', 'live');
    firestore.seed('_known_listing_manifests', 'shard-0', { knownListingIds: [liveId] });
    firestore.seed('listings', liveId, row('job-1', 'live'));

    await expect(storage.getAllEntriesFromListings()).rejects.toThrow(/expected all 16 shards/);
    expect(index.isKnownListingIndexLoaded()).toBe(false);
  });
});
