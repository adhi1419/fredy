/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryDeliveryError } from '../../../lib/services/inquiries/errors.js';

let reserveResult;
let sendImpl;
let finishImpl;
let storeMessageImpl;
const finishCalls = [];
const sendCalls = [];

vi.mock('../../../lib/services/storage/listingsStorage.js', () => ({
  reserveInquirySend: async () => reserveResult,
  setInquiryMessage: async (...args) => storeMessageImpl(...args),
  finishInquirySend: async (...args) => {
    finishCalls.push(args);
    return finishImpl(...args);
  },
}));
vi.mock('../../../lib/services/inquiries/sendInquiry.js', () => ({
  sendInquiry: async (params) => {
    sendCalls.push(params);
    return sendImpl(params);
  },
}));

const { deliverInquiry } = await import('../../../lib/services/inquiries/deliverInquiry.js');

const params = () => ({
  providerId: 'immoscout',
  listing: { id: 'L1', link: 'https://www.immobilienscout24.de/expose/1' },
  profile: { name: 'Alice Example' },
  accountEmail: 'alice@example.com',
  message: 'Hallo',
});

describe('deliverInquiry', () => {
  beforeEach(() => {
    reserveResult = true;
    storeMessageImpl = async () => 1;
    sendImpl = async () => ({ requestId: 'request-1', sentAt: 1234 });
    finishImpl = async () => 1;
    finishCalls.length = 0;
    sendCalls.length = 0;
  });

  it('records a confirmed send and annotates the in-memory listing', async () => {
    const input = params();
    await expect(deliverInquiry(input)).resolves.toMatchObject({ status: 'sent', requestId: 'request-1' });
    expect(finishCalls[0][1]).toMatchObject({ status: 'sent', requestId: 'request-1', sentAt: 1234 });
    expect(input.listing.inquirySendStatus).toBe('sent');
  });

  it('does not call the provider when another attempt owns the reservation', async () => {
    reserveResult = false;
    await expect(deliverInquiry(params())).resolves.toMatchObject({ started: false });
    expect(sendCalls).toEqual([]);
  });

  it('records an ambiguous provider error as unknown', async () => {
    sendImpl = async () => {
      throw new InquiryDeliveryError('unknown', { outcome: 'unknown' });
    };
    await expect(deliverInquiry(params())).rejects.toMatchObject({ outcome: 'unknown' });
    expect(finishCalls[0][1].status).toBe('unknown');
  });

  it('never marks a confirmed remote send as failed when completion persistence throws', async () => {
    finishImpl = async () => {
      throw new Error('database unavailable');
    };
    await expect(deliverInquiry(params())).rejects.toMatchObject({ outcome: 'unknown' });
    expect(finishCalls).toHaveLength(1);
    expect(finishCalls[0][1].status).toBe('sent');
  });

  it('treats a missing reservation during completion as unknown', async () => {
    finishImpl = async () => 0;
    await expect(deliverInquiry(params())).rejects.toMatchObject({ outcome: 'unknown' });
    expect(finishCalls).toHaveLength(1);
  });
});
