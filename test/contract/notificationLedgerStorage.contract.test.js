/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: notificationLedgerStorage
 *
 * Firestore behavioral contract for the per-listing/per-channel notification delivery ledger.
 * Runs against the local Firestore emulator through the shared contract harness and drives the
 * concrete production reserve/finish transactions. Every storage call is awaited because Firestore
 * is async.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let ledger;
let collections;
let jobStorage;

beforeAll(async () => {
  await initBackend();
  ledger = await loadStorageModule('notificationLedgerStorage');
  jobStorage = await loadStorageModule('jobStorage');
  collections = await import('../../lib/services/storage/firestore/collections.js');
});

beforeEach(async () => {
  await resetBackend();
});

afterAll(async () => {
  await teardownBackend();
});

const base = {
  listingId: 'listing-1',
  configuredAdapterId: 'channel-1',
  adapterId: 'telegram',
  ownerUserId: 'user-1',
  jobId: 'job-1',
};

describe('notificationLedgerStorage contract', () => {
  it('derives a deterministic delivery id and snapshots schema + timestamps + intended set', async () => {
    const res = await ledger.reserveDelivery({
      ...base,
      intendedConfiguredAdapterIds: ['channel-2', 'channel-1'],
      intendedChannelCount: 2,
      now: 1000,
    });
    expect(res.deliveryId).toBe(
      collections.deliveryDocId('listing-1', 'channel-1', collections.INITIAL_LISTING_NOTIFICATION_EVENT_KEY),
    );
    const row = await ledger.getDelivery({ listingId: 'listing-1', configuredAdapterId: 'channel-1' });
    expect(row).toMatchObject({
      listingId: 'listing-1',
      configuredAdapterId: 'channel-1',
      adapterId: 'telegram',
      ownerUserId: 'user-1',
      jobId: 'job-1',
      state: 'sending',
      eventKey: collections.INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
      schemaVersion: 1,
      createdAt: 1000,
      updatedAt: 1000,
      intendedConfiguredAdapterIds: ['channel-1', 'channel-2'],
      intendedChannelCount: 2,
    });
  });

  it('never persists channel secret fields or raw errors into the ledger document', async () => {
    const { deliveryId } = await ledger.reserveDelivery(base);
    await ledger.finishDelivery(deliveryId, {
      state: 'unknown',
      errorCode: 'https://hooks.example.com/T0/B0/secret',
    });
    const row = await ledger.getDeliveryById(deliveryId);
    for (const forbidden of ['fields', 'token', 'webhook', 'password', 'apiKey', 'chatId', 'secret', 'lastError']) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // A free-form / secret-bearing code is dropped, not stored.
    expect(row.errorCode).toBeNull();
  });

  it('persists only a closed safe error code', async () => {
    const { deliveryId } = await ledger.reserveDelivery(base);
    await ledger.finishDelivery(deliveryId, { state: 'unknown', errorCode: 'adapter_outcome_unknown' });
    expect((await ledger.getDeliveryById(deliveryId)).errorCode).toBe('adapter_outcome_unknown');
  });

  it('reservation blocks a duplicate while sending', async () => {
    await ledger.reserveDelivery(base);
    const dup = await ledger.reserveDelivery(base);
    expect(dup.reserved).toBe(false);
    expect(dup.state).toBe('sending');
  });

  it('two concurrent same-key reservations yield exactly one winner', async () => {
    const [a, b] = await Promise.all([
      ledger.reserveDelivery({ ...base, configuredAdapterId: 'race' }),
      ledger.reserveDelivery({ ...base, configuredAdapterId: 'race' }),
    ]);
    const winners = [a, b].filter((r) => r.reserved);
    expect(winners).toHaveLength(1);
    const loser = [a, b].find((r) => !r.reserved);
    expect(loser.state).toBe('sending');
  });

  it('sent, unknown, and sending never replay', async () => {
    const a = await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-sent' });
    await ledger.finishDelivery(a.deliveryId, { state: 'sent', sentAt: 5 });
    expect((await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-sent' })).reserved).toBe(false);

    const b = await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-unknown' });
    await ledger.finishDelivery(b.deliveryId, { state: 'unknown', errorCode: 'adapter_outcome_unknown' });
    expect((await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-unknown' })).reserved).toBe(false);

    await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-sending' });
    expect((await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c-sending' })).reserved).toBe(false);
  });

  it('only a proven-pre-side-effect failed can be re-reserved, preserving createdAt', async () => {
    const { deliveryId } = await ledger.reserveDelivery({ ...base, now: 1 });
    await ledger.finishDelivery(deliveryId, {
      state: 'failed',
      errorCode: 'adapter_rejected_pre_side_effect',
      now: 2,
    });
    const retry = await ledger.reserveDelivery({ ...base, now: 9 });
    expect(retry.reserved).toBe(true);
    const row = await ledger.getDeliveryById(deliveryId);
    expect(row.state).toBe('sending');
    expect(row.attempts).toBe(2);
    expect(row.createdAt).toBe(1);
    expect(row.updatedAt).toBe(9);
  });

  it('a sent-settlement on an already-settled record returns 0 (aggregate protection)', async () => {
    const { deliveryId } = await ledger.reserveDelivery(base);
    await expect(ledger.finishDelivery(deliveryId, { state: 'sent', sentAt: 77 })).resolves.toBe(1);
    // A second sent settlement does not stick — the caller must treat 0 as not-durably-sent.
    await expect(ledger.finishDelivery(deliveryId, { state: 'sent', sentAt: 99 })).resolves.toBe(0);
    const row = await ledger.getDeliveryById(deliveryId);
    expect(row).toMatchObject({ state: 'sent', sentAt: 77 });
  });

  it('two channels sharing an adapter type reserve independently', async () => {
    const one = await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c1', adapterId: 'telegram' });
    const two = await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c2', adapterId: 'telegram' });
    expect(one.reserved).toBe(true);
    expect(two.reserved).toBe(true);
    expect(one.deliveryId).not.toBe(two.deliveryId);
  });

  it('removes delivery evidence by listing without touching another listing', async () => {
    await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c1' });
    await ledger.reserveDelivery({ ...base, configuredAdapterId: 'c2' });
    await ledger.reserveDelivery({ ...base, listingId: 'listing-2', configuredAdapterId: 'c1' });

    await expect(ledger.deleteDeliveriesForListingIds(['listing-1'])).resolves.toBe(2);
    await expect(ledger.getDelivery({ listingId: 'listing-1', configuredAdapterId: 'c1' })).resolves.toBeNull();
    await expect(ledger.getDelivery({ listingId: 'listing-2', configuredAdapterId: 'c1' })).resolves.not.toBeNull();
  });

  it('removeJob cascades orphan delivery evidence even when no listing document remains', async () => {
    await jobStorage.upsertJob({
      jobId: 'job-cascade',
      userId: 'user-1',
      name: 'Cascade',
      provider: [],
      notificationAdapter: [],
    });
    await ledger.reserveDelivery({ ...base, jobId: 'job-cascade', configuredAdapterId: 'cascade-channel' });

    await jobStorage.removeJob('job-cascade');
    await expect(
      ledger.getDelivery({ listingId: 'listing-1', configuredAdapterId: 'cascade-channel' }),
    ).resolves.toBeNull();
  });

  it('requires every identity field before creating evidence', async () => {
    await expect(ledger.reserveDelivery({ ...base, ownerUserId: '' })).rejects.toThrow(/ownerUserId/);
    await expect(ledger.reserveDelivery({ ...base, jobId: '' })).rejects.toThrow(/jobId/);
  });
});
