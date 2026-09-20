/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMemory } from '../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();
vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const ledger = await import('../../lib/services/storage/notificationLedgerStorage.js');
const { deliveryDocId, INITIAL_LISTING_NOTIFICATION_EVENT_KEY } =
  await import('../../lib/services/storage/firestore/collections.js');

const COLLECTION = 'notification_deliveries';
const baseReservation = {
  listingId: 'L1',
  configuredAdapterId: 'c1',
  adapterId: 'telegram',
  ownerUserId: 'user-1',
  jobId: 'job-1',
};

beforeEach(() => firestore.clear());

describe('notificationLedgerStorage', () => {
  it('reserves an absent delivery and writes identity + schema + timestamps, never secrets', async () => {
    const res = await ledger.reserveDelivery({
      ...baseReservation,
      intendedConfiguredAdapterIds: ['c2', 'c1'],
      intendedChannelCount: 2,
      now: 1000,
    });
    expect(res.reserved).toBe(true);
    expect(res.state).toBe('sending');
    expect(res.deliveryId).toBe(deliveryDocId('L1', 'c1', INITIAL_LISTING_NOTIFICATION_EVENT_KEY));

    const doc = firestore.read(COLLECTION, res.deliveryId);
    expect(doc).toMatchObject({
      schemaVersion: 1,
      ownerUserId: 'user-1',
      jobId: 'job-1',
      listingId: 'L1',
      configuredAdapterId: 'c1',
      adapterId: 'telegram',
      eventKey: INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
      state: 'sending',
      attempts: 1,
      reservedAt: 1000,
      createdAt: 1000,
      updatedAt: 1000,
      // Snapshot is sorted regardless of input order.
      intendedConfiguredAdapterIds: ['c1', 'c2'],
      intendedChannelCount: 2,
      errorCode: null,
    });
    for (const key of Object.keys(doc)) {
      expect(['token', 'fields', 'webhook', 'password', 'apiKey', 'chatId', 'lastError']).not.toContain(key);
    }
  });

  it('defaults the intended set to the single channel when none is passed', async () => {
    const res = await ledger.reserveDelivery(baseReservation);
    expect(firestore.read(COLLECTION, res.deliveryId)).toMatchObject({
      intendedConfiguredAdapterIds: ['c1'],
      intendedChannelCount: 1,
    });
  });

  it('blocks a second reservation while sending (in-flight)', async () => {
    await ledger.reserveDelivery(baseReservation);
    const second = await ledger.reserveDelivery(baseReservation);
    expect(second.reserved).toBe(false);
    expect(second.state).toBe('sending');
  });

  it('blocks a reservation once sent (terminal success never replays)', async () => {
    const { deliveryId } = await ledger.reserveDelivery(baseReservation);
    await ledger.finishDelivery(deliveryId, { state: 'sent', sentAt: 2000, now: 2000 });
    const again = await ledger.reserveDelivery(baseReservation);
    expect(again.reserved).toBe(false);
    expect(again.state).toBe('sent');
  });

  it('blocks a reservation when unknown (ambiguous never auto-replays)', async () => {
    const { deliveryId } = await ledger.reserveDelivery(baseReservation);
    await ledger.finishDelivery(deliveryId, { state: 'unknown', errorCode: 'adapter_outcome_unknown' });
    const again = await ledger.reserveDelivery(baseReservation);
    expect(again.reserved).toBe(false);
    expect(again.state).toBe('unknown');
  });

  it('allows re-reservation only after a proven-pre-side-effect failed, preserving createdAt', async () => {
    const { deliveryId } = await ledger.reserveDelivery({ ...baseReservation, now: 1 });
    await ledger.finishDelivery(deliveryId, {
      state: 'failed',
      errorCode: 'adapter_rejected_pre_side_effect',
      now: 2,
    });
    const retry = await ledger.reserveDelivery({ ...baseReservation, now: 5 });
    expect(retry.reserved).toBe(true);
    expect(retry.state).toBe('sending');
    expect(firestore.read(COLLECTION, deliveryId)).toMatchObject({
      state: 'sending',
      attempts: 2,
      reservedAt: 5,
      updatedAt: 5,
      createdAt: 1, // preserved across the re-reservation
      errorCode: null,
    });
  });

  it('finish is a no-op unless the record is currently sending', async () => {
    const { deliveryId } = await ledger.reserveDelivery(baseReservation);
    await ledger.finishDelivery(deliveryId, { state: 'sent', now: 10 });
    await expect(ledger.finishDelivery(deliveryId, { state: 'unknown' })).resolves.toBe(0);
    expect(firestore.read(COLLECTION, deliveryId)).toMatchObject({ state: 'sent' });
  });

  it('sent stamps sentAt + updatedAt and clears errorCode', async () => {
    const r1 = await ledger.reserveDelivery(baseReservation);
    await ledger.finishDelivery(r1.deliveryId, { state: 'sent', sentAt: 42, now: 44 });
    expect(firestore.read(COLLECTION, r1.deliveryId)).toMatchObject({
      state: 'sent',
      sentAt: 42,
      updatedAt: 44,
      errorCode: null,
    });
  });

  it('persists only closed safe error codes; unknown/free-form codes are dropped', async () => {
    const r1 = await ledger.reserveDelivery({ ...baseReservation, configuredAdapterId: 'c-known' });
    await ledger.finishDelivery(r1.deliveryId, { state: 'unknown', errorCode: 'adapter_outcome_unknown' });
    expect(firestore.read(COLLECTION, r1.deliveryId)).toMatchObject({ errorCode: 'adapter_outcome_unknown' });

    // A secret-bearing / free-form code (e.g. a raw URL) is dropped, never stored.
    const r2 = await ledger.reserveDelivery({ ...baseReservation, configuredAdapterId: 'c-leak' });
    await ledger.finishDelivery(r2.deliveryId, {
      state: 'unknown',
      errorCode: 'https://hooks.example.com/T000/B000/secret',
    });
    expect(firestore.read(COLLECTION, r2.deliveryId)).toMatchObject({ errorCode: null });
  });

  it('rejects an invalid finish state', async () => {
    const { deliveryId } = await ledger.reserveDelivery(baseReservation);
    await expect(ledger.finishDelivery(deliveryId, { state: 'weird' })).rejects.toThrow(
      /Invalid delivery finish state/,
    );
  });

  it('rejects malformed intended-channel snapshots before creating evidence', async () => {
    await expect(
      ledger.reserveDelivery({
        ...baseReservation,
        intendedConfiguredAdapterIds: ['c1', 'c1'],
        intendedChannelCount: 2,
      }),
    ).rejects.toThrow(/distinct intended channel set/);
    await expect(
      ledger.reserveDelivery({
        ...baseReservation,
        intendedConfiguredAdapterIds: ['c2'],
        intendedChannelCount: 1,
      }),
    ).rejects.toThrow(/containing the target channel/);
    await expect(
      ledger.reserveDelivery({
        ...baseReservation,
        intendedConfiguredAdapterIds: ['c1', 'c2'],
        intendedChannelCount: 1,
      }),
    ).rejects.toThrow(/intendedChannelCount/);
    expect(firestore.list(COLLECTION)).toHaveLength(0);
  });

  it('fails closed on malformed state or mismatched stored identity', async () => {
    const malformedId = deliveryDocId('L1', 'c1', INITIAL_LISTING_NOTIFICATION_EVENT_KEY);
    firestore.seed(COLLECTION, malformedId, { state: 'mystery' });
    await expect(ledger.reserveDelivery(baseReservation)).rejects.toThrow(/invalid state/);

    firestore.clear();
    firestore.seed(COLLECTION, malformedId, {
      schemaVersion: 1,
      ownerUserId: 'another-user',
      jobId: 'job-1',
      listingId: 'L1',
      configuredAdapterId: 'c1',
      adapterId: 'telegram',
      eventKey: INITIAL_LISTING_NOTIFICATION_EVENT_KEY,
      state: 'failed',
    });
    await expect(ledger.reserveDelivery(baseReservation)).rejects.toThrow(/mismatched stored identity/);
  });

  it('requires every identity field before creating evidence', async () => {
    await expect(ledger.reserveDelivery({ ...baseReservation, listingId: '' })).rejects.toThrow(/listingId/);
    await expect(ledger.reserveDelivery({ ...baseReservation, listingId: '   ' })).rejects.toThrow(/listingId/);
    await expect(ledger.reserveDelivery({ ...baseReservation, configuredAdapterId: '' })).rejects.toThrow(
      /configuredAdapterId/,
    );
    await expect(ledger.reserveDelivery({ ...baseReservation, adapterId: '' })).rejects.toThrow(/adapterId/);
    await expect(ledger.reserveDelivery({ ...baseReservation, ownerUserId: '' })).rejects.toThrow(/ownerUserId/);
    await expect(ledger.reserveDelivery({ ...baseReservation, jobId: '' })).rejects.toThrow(/jobId/);
    await expect(ledger.reserveDelivery({ ...baseReservation, eventKey: '' })).rejects.toThrow(/eventKey/);
  });

  it('getDelivery projects the new fields by logical identity', async () => {
    await ledger.reserveDelivery({ ...baseReservation, intendedConfiguredAdapterIds: ['c1'], now: 7 });
    const row = await ledger.getDelivery({ listingId: 'L1', configuredAdapterId: 'c1' });
    expect(row).toMatchObject({
      listingId: 'L1',
      configuredAdapterId: 'c1',
      state: 'sending',
      schemaVersion: 1,
      intendedChannelCount: 1,
      createdAt: 7,
      updatedAt: 7,
    });
    expect(await ledger.getDelivery({ listingId: 'nope', configuredAdapterId: 'c1' })).toBeNull();
  });
});
