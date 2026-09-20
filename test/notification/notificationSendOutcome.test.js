/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { assertSendResolved } from '../../lib/notification/notificationSendOutcome.js';

describe('assertSendResolved', () => {
  it('accepts undefined and ordinary SDK success objects', async () => {
    await expect(assertSendResolved(undefined)).resolves.toBeUndefined();
    await expect(assertSendResolved({ id: 'msg-1', ok: true })).resolves.toBeUndefined();
    await expect(assertSendResolved({ messageId: 123 })).resolves.toBeUndefined();
  });

  it('accepts an allSettled array of fulfilled results', async () => {
    await expect(
      assertSendResolved([
        { status: 'fulfilled', value: { ok: true } },
        { status: 'fulfilled', value: undefined },
      ]),
    ).resolves.toBeUndefined();
  });

  it('rejects when any allSettled entry is rejected', async () => {
    await expect(
      assertSendResolved([
        { status: 'fulfilled', value: { ok: true } },
        { status: 'rejected', reason: new Error('boom') },
      ]),
    ).rejects.toThrow(/settlement rejected/);
  });

  it('awaits nested adapter promises and rejects a nested rejection', async () => {
    await expect(assertSendResolved([Promise.resolve({ ok: true, status: 200 })])).resolves.toBeUndefined();
    await expect(assertSendResolved([Promise.reject(new Error('secret-bearing failure'))])).rejects.toThrow(
      /adapter promise rejected/,
    );
  });

  it('rejects an empty result array because no delivery was attempted', async () => {
    await expect(assertSendResolved([])).rejects.toThrow(/no delivery results/);
  });

  it('rejects a fulfilled settlement whose nested value is a non-2xx Response', async () => {
    await expect(assertSendResolved([{ status: 'fulfilled', value: { ok: false, status: 500 } }])).rejects.toThrow(
      /non-2xx status 500/,
    );
  });

  it('rejects a bare non-2xx Response-like value', async () => {
    await expect(assertSendResolved({ ok: false, status: 429 })).rejects.toThrow(/non-2xx status 429/);
  });

  it('accepts a 2xx Response-like value', async () => {
    await expect(assertSendResolved({ ok: true, status: 200 })).resolves.toBeUndefined();
  });

  it('never leaks a rejection reason that may embed a secret URL or token', async () => {
    const failure = assertSendResolved([
      { status: 'rejected', reason: new Error('POST https://hooks.example.com/T0/B0/secretToken failed') },
    ]);
    await expect(failure).rejects.toThrow(/settlement rejected/);
    await expect(failure).rejects.not.toThrow(/hooks\.example\.com|secretToken/);
  });
});

// sendOneToChannel drives the outcome validator against mocked adapters loaded through the real
// notify plugin loader. The adapter directory is loaded once at import, so we mock the loader.
import { vi } from 'vitest';

const adapterModules = [
  { config: { id: 'allsettled' }, send: vi.fn() },
  { config: { id: 'httpish' }, send: vi.fn() },
];
vi.mock('../../lib/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getNotificationAdapters: async () => adapterModules };
});

const notify = await import('../../lib/notification/notify.js');

const call = (adapterId) =>
  notify.sendOneToChannel({
    serviceName: 'immoscout',
    listing: { id: 'L1' },
    channel: { id: adapterId, configuredAdapterId: `chan-${adapterId}`, fields: {} },
    jobKey: 'job-1',
    baseUrl: 'https://example.test',
  });

describe('sendOneToChannel outcome gating', () => {
  it('treats a fully-successful allSettled array as sent', async () => {
    adapterModules[0].send.mockResolvedValueOnce([
      { status: 'fulfilled', value: { ok: true } },
      { status: 'fulfilled', value: undefined },
    ]);
    await expect(call('allsettled')).resolves.toBeDefined();
  });

  it('rejects when an allSettled array contains a rejected entry (cannot become sent)', async () => {
    adapterModules[0].send.mockResolvedValueOnce([
      { status: 'fulfilled', value: { ok: true } },
      { status: 'rejected', reason: new Error('channel down') },
    ]);
    await expect(call('allsettled')).rejects.toThrow(/settlement rejected/);
  });

  it('rejects a non-2xx Response result (cannot become sent)', async () => {
    adapterModules[1].send.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(call('httpish')).rejects.toThrow(/non-2xx status 503/);
  });

  it('accepts a 2xx Response result', async () => {
    adapterModules[1].send.mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(call('httpish')).resolves.toBeDefined();
  });

  it('rejects an empty adapter result because no delivery was attempted', async () => {
    adapterModules[0].send.mockResolvedValueOnce([]);
    await expect(call('allsettled')).rejects.toThrow(/no delivery results/);
  });

  it('awaits and rejects a legacy nested promise result', async () => {
    adapterModules[0].send.mockResolvedValueOnce([Promise.reject(new Error('ambiguous'))]);
    await expect(call('allsettled')).rejects.toThrow(/adapter promise rejected/);
  });

  it('throws for an unknown adapter id', async () => {
    await expect(call('nope')).rejects.toThrow(/not found/);
  });
});
