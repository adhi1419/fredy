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

// Real ledger semantics against the in-memory store — the orchestrator is exercised against the
// production reserve/finish transactions, not a hand-rolled stub.
const ledger = await import('../../lib/services/storage/notificationLedgerStorage.js');
const { orchestrateNotificationDelivery } = await import('../../lib/notification/notificationDeliveryOrchestrator.js');

const channel = (configuredAdapterId, adapterId) => ({
  id: adapterId,
  configuredAdapterId,
  name: configuredAdapterId,
  fields: { token: 'secret', chatId: '123' },
});

/** A markNotificationComplete that is write-once, mirroring the real listing storage contract. */
const makeMarkComplete = () => {
  const completed = new Map();
  const fn = vi.fn(async (listingId, notifiedAt) => {
    if (completed.has(listingId)) return 0;
    completed.set(listingId, notifiedAt);
    return 1;
  });
  fn.completed = completed;
  return fn;
};

const run = ({ listings, notificationConfig, sendOneToChannel, markComplete, now }) =>
  orchestrateNotificationDelivery(
    {
      listings,
      notificationConfig,
      serviceName: 'immoscout',
      jobId: 'job-1',
      ownerUserId: 'user-1',
      baseUrl: 'https://example.test',
    },
    {
      reserveDelivery: ledger.reserveDelivery,
      finishDelivery: ledger.finishDelivery,
      sendOneToChannel,
      markNotificationComplete: markComplete,
      now: now ?? (() => 1000),
    },
  );

beforeEach(() => firestore.clear());

describe('orchestrateNotificationDelivery', () => {
  it('sends one listing per channel and marks complete when every channel succeeds', async () => {
    const sendOneToChannel = vi.fn(async () => ({ ok: true }));
    const markComplete = makeMarkComplete();

    const summary = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [channel('c1', 'telegram'), channel('c2', 'slack')],
      sendOneToChannel,
      markComplete,
    });

    expect(sendOneToChannel).toHaveBeenCalledTimes(2);
    // Each call is a single listing to a single channel — no fan-out batch.
    for (const call of sendOneToChannel.mock.calls) {
      expect(call[0].listing).toEqual({ id: 'L1' });
      expect(call[0].channel.configuredAdapterId).toMatch(/^c[12]$/);
    }
    expect(summary).toMatchObject({ attempted: 2, sent: 2, blocked: 0, unknown: 0, listingsCompleted: 1 });
    expect(markComplete).toHaveBeenCalledWith('L1', 1000);
  });

  it('hands each adapter only its own channel entry (no cross-channel secret bleed)', async () => {
    const seen = [];
    const sendOneToChannel = vi.fn(async ({ channel: ch }) => seen.push(ch.configuredAdapterId));
    await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [channel('c1', 'telegram'), channel('c2', 'telegram')],
      sendOneToChannel,
      markComplete: makeMarkComplete(),
    });
    expect(seen.sort()).toEqual(['c1', 'c2']);
  });

  it('leaves the aggregate incomplete when one channel fails (ambiguous -> unknown)', async () => {
    const sendOneToChannel = vi.fn(async ({ channel: ch }) => {
      if (ch.configuredAdapterId === 'c2') throw new Error('adapter rejected');
      return { ok: true };
    });
    const markComplete = makeMarkComplete();

    const summary = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [channel('c1', 'telegram'), channel('c2', 'slack')],
      sendOneToChannel,
      markComplete,
    });

    expect(summary).toMatchObject({ sent: 1, unknown: 1, listingsCompleted: 0 });
    expect(markComplete).not.toHaveBeenCalled();
    // The failed channel is recorded unknown — terminal for automation.
    expect((await ledger.getDelivery({ listingId: 'L1', configuredAdapterId: 'c2' })).state).toBe('unknown');
    expect((await ledger.getDelivery({ listingId: 'L1', configuredAdapterId: 'c1' })).state).toBe('sent');
  });

  it('is externally inert on a second execution (no duplicate sends, no re-mark)', async () => {
    const config = [channel('c1', 'telegram'), channel('c2', 'slack')];
    const send1 = vi.fn(async () => ({ ok: true }));
    const mark1 = makeMarkComplete();
    await run({ listings: [{ id: 'L1' }], notificationConfig: config, sendOneToChannel: send1, markComplete: mark1 });
    expect(send1).toHaveBeenCalledTimes(2);
    expect(mark1).toHaveBeenCalledTimes(1);

    // Second run over the same listing: every channel is already `sent`, so nothing is sent again.
    // Reuse the same write-once mark instance to model the persistent Firestore flag.
    const send2 = vi.fn(async () => ({ ok: true }));
    const summary2 = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: config,
      sendOneToChannel: send2,
      markComplete: mark1,
    });
    expect(send2).not.toHaveBeenCalled();
    expect(summary2).toMatchObject({ attempted: 0, sent: 0, blocked: 2 });
    // All channels still counted as sent, so completion is re-evaluated true and re-mark attempted,
    // but the write-once flag is already set, so it flips nothing (listingsCompleted stays 0).
    expect(summary2.listingsCompleted).toBe(0);
    expect(mark1).toHaveBeenCalledTimes(2);
  });

  it('an unknown channel is never retried on a later run and blocks completion forever', async () => {
    const config = [channel('c1', 'telegram'), channel('c2', 'slack')];
    const send1 = vi.fn(async ({ channel: ch }) => {
      if (ch.configuredAdapterId === 'c2') throw new Error('ambiguous');
      return { ok: true };
    });
    await run({
      listings: [{ id: 'L1' }],
      notificationConfig: config,
      sendOneToChannel: send1,
      markComplete: makeMarkComplete(),
    });

    const send2 = vi.fn(async () => ({ ok: true }));
    const mark2 = makeMarkComplete();
    const summary2 = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: config,
      sendOneToChannel: send2,
      markComplete: mark2,
    });
    // c1 already sent (blocked), c2 unknown (blocked) — nothing attempted, never complete.
    expect(send2).not.toHaveBeenCalled();
    expect(summary2).toMatchObject({ attempted: 0, blocked: 2, listingsCompleted: 0 });
    expect(mark2).not.toHaveBeenCalled();
  });

  it('does not mark notification complete for a listing with no configured channels', async () => {
    const sendOneToChannel = vi.fn();
    const markComplete = makeMarkComplete();
    const summary = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [],
      sendOneToChannel,
      markComplete,
    });
    expect(sendOneToChannel).not.toHaveBeenCalled();
    expect(markComplete).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ attempted: 0, listingsCompleted: 0, listingsWithTargets: 0 });
  });

  it('settles each listing independently across a batch', async () => {
    const sendOneToChannel = vi.fn(async ({ listing }) => {
      if (listing.id === 'L2') throw new Error('reject');
      return { ok: true };
    });
    const markComplete = makeMarkComplete();
    const summary = await run({
      listings: [{ id: 'L1' }, { id: 'L2' }],
      notificationConfig: [channel('c1', 'telegram')],
      sendOneToChannel,
      markComplete,
    });
    expect(summary).toMatchObject({ attempted: 2, sent: 1, unknown: 1, listingsCompleted: 1 });
    expect(markComplete).toHaveBeenCalledTimes(1);
    expect(markComplete).toHaveBeenCalledWith('L1', expect.any(Number));
  });

  it('skips channel references missing a configuredAdapterId', async () => {
    const sendOneToChannel = vi.fn(async () => ({ ok: true }));
    const markComplete = makeMarkComplete();
    const summary = await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [{ id: 'telegram' }], // legacy ref with no channel id
      sendOneToChannel,
      markComplete,
    });
    expect(sendOneToChannel).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ attempted: 0, listingsWithTargets: 0, listingsCompleted: 0 });
  });

  it('persists the sorted intended-channel snapshot on every ledger record', async () => {
    await run({
      listings: [{ id: 'L1' }],
      notificationConfig: [channel('c2', 'slack'), channel('c1', 'telegram')],
      sendOneToChannel: vi.fn(async () => ({ ok: true })),
      markComplete: makeMarkComplete(),
    });
    for (const cid of ['c1', 'c2']) {
      const row = await ledger.getDelivery({ listingId: 'L1', configuredAdapterId: cid });
      expect(row.intendedConfiguredAdapterIds).toEqual(['c1', 'c2']);
      expect(row.intendedChannelCount).toBe(2);
    }
  });

  it('does NOT count a channel as sent when the sent-settlement is not durably accepted', async () => {
    // A send that resolves cleanly, but a finishDelivery that returns 0 (settlement did not stick):
    // the listing must NOT be marked complete and no re-send is attempted.
    const sendOneToChannel = vi.fn(async () => ({ ok: true }));
    const markComplete = makeMarkComplete();
    const finishDelivery = vi.fn(async (_id, { state }) => (state === 'sent' ? 0 : 1));
    const summary = await orchestrateNotificationDelivery(
      {
        listings: [{ id: 'L1' }],
        notificationConfig: [channel('c1', 'telegram')],
        serviceName: 'immoscout',
        jobId: 'job-1',
        ownerUserId: 'user-1',
        baseUrl: 'https://example.test',
      },
      {
        reserveDelivery: ledger.reserveDelivery,
        finishDelivery,
        sendOneToChannel,
        markNotificationComplete: markComplete,
        now: () => 1000,
      },
    );
    expect(sendOneToChannel).toHaveBeenCalledTimes(1); // sent once, never re-sent
    expect(summary).toMatchObject({ attempted: 1, sent: 0, unknown: 1, listingsCompleted: 0 });
    expect(markComplete).not.toHaveBeenCalled();
  });

  it('records unknown with a closed non-secret errorCode, never a raw adapter error', async () => {
    const finishCalls = [];
    const finishDelivery = vi.fn(async (id, result) => {
      finishCalls.push(result);
      return 1;
    });
    const sendOneToChannel = vi.fn(async () => {
      throw new Error('POST https://hooks.example.com/T00/B00/superSecretToken failed');
    });
    await orchestrateNotificationDelivery(
      {
        listings: [{ id: 'L1' }],
        notificationConfig: [channel('c1', 'telegram')],
        serviceName: 'immoscout',
        jobId: 'job-1',
        ownerUserId: 'user-1',
        baseUrl: 'https://example.test',
      },
      {
        reserveDelivery: ledger.reserveDelivery,
        finishDelivery,
        sendOneToChannel,
        markNotificationComplete: makeMarkComplete(),
        now: () => 1000,
      },
    );
    const unknownCall = finishCalls.find((c) => c.state === 'unknown');
    expect(unknownCall.errorCode).toBe('adapter_outcome_unknown');
    // No raw error / URL / token is threaded to the ledger.
    expect(JSON.stringify(unknownCall)).not.toMatch(/hooks\.example\.com|superSecretToken/);
  });
});
