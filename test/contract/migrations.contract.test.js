/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import FirestoreConnection from '../../lib/services/storage/firestore/FirestoreConnection.js';
import { resetKnownListingIndex } from '../../lib/services/storage/firestore/knownListingIndex.js';
import { listingDocId } from '../../lib/services/storage/firestore/collections.js';
import {
  MANIFEST_SHARD_COUNT,
  addKnownListingIdsToManifest,
  loadKnownListingManifest,
  manifestDocId,
  manifestShardForListingId,
  removeKnownListingIdsFromManifest,
} from '../../lib/services/storage/firestore/knownListingManifest.js';
import { withFirestoreUsageScope, currentFirestoreUsage } from '../../lib/services/storage/firestore/firestoreUsage.js';
import { runMigrations } from '../../scripts/migrations/run.js';

let stateDir;
let db;
let listingsStorage;

beforeAll(async () => {
  await FirestoreConnection.init();
  db = FirestoreConnection.getConnection();
  listingsStorage = await import('../../lib/services/storage/listingsStorage.js');
  stateDir = await fs.mkdtemp(path.join(process.env.KIROCREW_SCRATCH ?? os.tmpdir(), 'fredy-migrations-'));
});

beforeEach(async () => {
  await FirestoreConnection.clearAllData();
  resetKnownListingIndex();
  await fs.rm(stateDir, { recursive: true, force: true });
});

afterAll(async () => {
  await FirestoreConnection.close();
});

async function dryRun(id) {
  const [result] = await runMigrations({ only: id, stateDir, db });
  expect(result.applied).toBe(false);
  return result.planHash;
}

async function apply(id, hash) {
  const [result] = await runMigrations({ only: id, apply: true, planHash: hash, stateDir, db });
  expect(result.applied).toBe(true);
  return result;
}

describe('Firestore migrations', () => {
  it('does not write during a dry run and applies 001 idempotently', async () => {
    await db.collection('listings').doc('rejected').set({
      inquirySendStatus: 'failed',
      inquirySendError: 'The listing does not contain an ImmoScout exposé id.',
    });
    const hash = await dryRun('001-inquiry-rejected');
    expect((await db.collection('listings').doc('rejected').get()).data().inquirySendStatus).toBe('failed');
    await apply('001-inquiry-rejected', hash);
    expect((await db.collection('listings').doc('rejected').get()).data().inquirySendStatus).toBe('rejected');
    const second = await runMigrations({ only: '001-inquiry-rejected', apply: true, planHash: hash, stateDir, db });
    expect(second[0].skipped).toBe(true);
  });

  it('backfills lifecycle and removes status in 002', async () => {
    await db
      .collection('listings')
      .doc('legacy')
      .set({ status: JSON.stringify({ status: 'applied', setAt: 7 }) });
    await apply('002-lifecycle-backfill', await dryRun('002-lifecycle-backfill'));
    const data = (await db.collection('listings').doc('legacy').get()).data();
    expect(data.lifecycle.state).toBe('applied');
    expect(data.status).toBeUndefined();
  });

  it('materializes source policies and removes autoSendInquiry in 003', async () => {
    await db
      .collection('jobs')
      .doc('job')
      .set({
        autoSendInquiry: false,
        provider: [{ id: 'immoscout', url: 'https://www.immobilienscout24.de' }],
      });
    await apply('003-application-policy', await dryRun('003-application-policy'));
    const data = (await db.collection('jobs').doc('job').get()).data();
    expect(data.autoSendInquiry).toBeUndefined();
    expect(data.provider[0].applicationPolicy).toEqual({ automatic: 'disabled' });
  });

  it('deletes sessions and obsolete user fields in 004', async () => {
    await db.collection('sessions').doc('session').set({ userId: 'u' });
    await db.collection('users').doc('user').set({ password: 'old', mcpToken: 'old', username: 'u' });
    await apply('004-dead-data', await dryRun('004-dead-data'));
    expect((await db.collection('sessions').doc('session').get()).exists).toBe(false);
    expect((await db.collection('users').doc('user').get()).data()).toEqual({ username: 'u' });
  });

  it('backfills missing optional values without overwriting existing values in 005', async () => {
    await db.collection('listings').doc('listing').set({ title: 'keep', price: 42, notificationComplete: true });
    await apply('005-explicit-nulls', await dryRun('005-explicit-nulls'));
    const data = (await db.collection('listings').doc('listing').get()).data();
    expect(data.title).toBe('keep');
    expect(data.price).toBe(42);
    expect(data.notificationComplete).toBe(true);
    expect(data.description).toBeNull();
    expect(data.activeCheckFailures).toBe(0);
    expect(data.travelTimeFailures).toBe(0);
  });

  it('renames create_date and deletes retired settings in 006', async () => {
    await db.collection('settings').doc('keep').set({ name: 'theme', value: '"dark"', userId: 'u', create_date: 7 });
    await db
      .collection('settings')
      .doc('secret')
      .set({ name: 'session_secret', value: '"x"', userId: null, create_date: 1 });
    await db.collection('settings').doc('news').set({ name: 'news_last_seen_version', value: '"1"', userId: 'u' });
    await apply('006-settings-shape', await dryRun('006-settings-shape'));
    expect((await db.collection('settings').doc('keep').get()).data()).toEqual({
      name: 'theme',
      value: '"dark"',
      userId: 'u',
      createdAt: 7,
    });
    expect((await db.collection('settings').doc('secret').get()).exists).toBe(false);
    expect((await db.collection('settings').doc('news').get()).exists).toBe(false);
  });

  it('gives addresses ids and re-keys commute limits and travel times by them in 008', async () => {
    const addresses = [
      { label: 'Work', address: 'EDGE East Side Tower, Berlin', coords: { lat: 1, lng: 2 } },
      { label: 'Gym', address: 'Gym Street 1', coords: { lat: 3, lng: 4 } },
    ];
    await db
      .collection('settings')
      .doc('u1__home_addresses')
      .set({ name: 'home_addresses', userId: 'u1', value: JSON.stringify(addresses) });
    // One key left over from before Work was renamed (the address text), one current, one dead.
    await db
      .collection('jobs')
      .doc('j1')
      .set({
        userId: 'u1',
        commuteFilter: { action: 'exclude', limits: { 'EDGE East Side Tower, Berlin': 25, Gym: 15, Gone: 10 } },
      });
    await db.collection('listings').doc('l1').set({ jobId: 'j1' });
    const tt = db.collection('listings').doc('l1').collection('travel_times');
    await tt
      .doc('EDGE East Side Tower, Berlin')
      .set({ label: 'EDGE East Side Tower, Berlin', transitMinutes: 30, computedAt: 1 });
    await tt.doc('Work').set({ label: 'Work', transitMinutes: 22, computedAt: 2 });
    await tt.doc('Gone').set({ label: 'Gone', transitMinutes: 5, computedAt: 3 });

    const hash = await dryRun('008-address-ids');
    expect((await tt.get()).docs.map((doc) => doc.id).sort()).toEqual(['EDGE East Side Tower, Berlin', 'Gone', 'Work']);
    await apply('008-address-ids', hash);

    const saved = JSON.parse((await db.collection('settings').doc('u1__home_addresses').get()).data().value);
    const [work, gym] = saved;
    expect(work).toMatchObject({ label: 'Work', id: expect.stringMatching(/^addr_/) });
    expect(gym.id).not.toBe(work.id);

    expect((await db.collection('jobs').doc('j1').get()).data().commuteFilter).toEqual({
      action: 'exclude',
      limits: { [work.id]: 25, [gym.id]: 15 },
    });

    // Both old Work documents collapse into one under the id; the newer answer wins.
    const docs = (await tt.get()).docs;
    expect(docs.map((doc) => doc.id)).toEqual([work.id]);
    expect(docs[0].data()).toMatchObject({ addressId: work.id, label: 'Work', transitMinutes: 22 });

    // A second run finds nothing to do.
    const [again] = await runMigrations({ only: '008-address-ids', stateDir, db });
    expect(again.skipped ?? again.changes).toBeTruthy();
  });

  it('backfills idempotent manifests and avoids reading tombstones during cold-start similarity hydration', async () => {
    const liveId = listingDocId('job-1', 'live');
    const tombstoneId = listingDocId('job-1', 'tombstone');
    await db.collection('listings').doc(liveId).set({
      jobId: 'job-1',
      provider: 'provider-1',
      hash: 'live',
      manuallyDeleted: false,
      title: 'Live listing',
      address: 'Main 1',
      price: 1000,
      size: 60,
      rooms: 2,
      description: 'live',
    });
    await db.collection('listings').doc(tombstoneId).set({
      jobId: 'job-1',
      provider: 'provider-1',
      hash: 'tombstone',
      manuallyDeleted: true,
      title: 'Deleted listing',
    });
    for (let i = 0; i < 8; i++) {
      await db
        .collection('listings')
        .doc(`old-${i}`)
        .set({
          jobId: 'job-1',
          provider: 'provider-1',
          hash: `old-${i}`,
          manuallyDeleted: true,
        });
    }

    const hash = await dryRun('010-known-listing-manifests');
    await apply('010-known-listing-manifests', hash);
    expect((await db.collection('_known_listing_manifests').get()).size).toBe(16);

    resetKnownListingIndex();
    let usage;
    const entries = await withFirestoreUsageScope('known-listing-cold-start', async () => {
      const result = await listingsStorage.getAllEntriesFromListings();
      usage = { ...currentFirestoreUsage() };
      return result;
    });
    expect(entries.map((entry) => entry.title)).toEqual(['Live listing']);
    expect(usage.reads).toBe(17);
    await expect(listingsStorage.findKnownHashes('job-1', 'provider-1', ['tombstone'])).resolves.toEqual(['tombstone']);

    const [again] = await runMigrations({ only: '010-known-listing-manifests', stateDir, db });
    expect(again.skipped).toBe(true);
  });

  it('retains identities from overlapping add and remove transforms on one shard', async () => {
    for (let index = 0; index < MANIFEST_SHARD_COUNT; index++) {
      await db
        .collection('_known_listing_manifests')
        .doc(manifestDocId(index.toString(16)))
        .set({ knownListingIds: [] });
    }
    const targetShard = manifestShardForListingId('concurrent-0');
    const ids = [];
    for (let index = 0; ids.length < 6; index++) {
      const id = `concurrent-${index}`;
      if (manifestShardForListingId(id) === targetShard) ids.push(id);
    }

    await Promise.all([
      addKnownListingIdsToManifest(ids.slice(0, 2)),
      addKnownListingIdsToManifest(ids.slice(2, 4)),
      addKnownListingIdsToManifest(ids.slice(4)),
    ]);
    const afterAdd = (await db.collection('_known_listing_manifests').doc(manifestDocId(targetShard)).get()).data();
    expect(afterAdd.knownListingIds).toEqual(expect.arrayContaining(ids));

    await Promise.all([
      removeKnownListingIdsFromManifest(ids.slice(0, 2)),
      removeKnownListingIdsFromManifest(ids.slice(2, 4)),
      removeKnownListingIdsFromManifest(ids.slice(4)),
    ]);
    const afterRemove = (await db.collection('_known_listing_manifests').doc(manifestDocId(targetShard)).get()).data();
    expect(afterRemove.knownListingIds).toEqual([]);
  });

  it('bootstraps the manifest on a fresh instance, also when two instances boot at once', async () => {
    await Promise.all([listingsStorage.getAllEntriesFromListings(), loadKnownListingManifest()]);
    const shards = await db.collection('_known_listing_manifests').get();
    expect(shards.size).toBe(MANIFEST_SHARD_COUNT);
    for (const shard of shards.docs) expect(shard.data().knownListingIds).toEqual([]);
  });

  it('does not bootstrap over existing listings', async () => {
    await db.collection('listings').doc('listing-1').set({ manuallyDeleted: false, title: 'needs migration' });
    await expect(loadKnownListingManifest()).rejects.toThrow(/010-known-listing-manifests/);
    expect((await db.collection('_known_listing_manifests').get()).size).toBe(0);
  });

  it('fails closed on an incomplete manifest without scanning listings', async () => {
    await db.collection('_known_listing_manifests').doc('shard-0').set({ knownListingIds: [] });
    await db.collection('listings').doc('listing-1').set({ manuallyDeleted: false, title: 'must not scan' });
    let usage;

    await expect(
      withFirestoreUsageScope('incomplete-known-listing-manifest', async () => {
        try {
          await listingsStorage.getAllEntriesFromListings();
        } finally {
          usage = { ...currentFirestoreUsage() };
        }
      }),
    ).rejects.toThrow(/expected all 16 shards/);
    expect(usage.reads).toBe(1);
  });
});
