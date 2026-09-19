/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildDeutscheWohnenContact,
  sendDeutscheWohnenInquiry,
} from '../../../lib/services/deutscheWohnen/contactClient.js';

const listing = {
  link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/schoen-hier-zu-wohnen-89-1471120007',
};
const profile = {
  name: 'Adhithya Rajagopal',
  email: 'attacker-controlled@example.net',
  phoneNumber: '+49 30 123456',
  deutscheWohnenIncomeType: '1',
  deutscheWohnenMonthlyNetIncome: 'M_3',
  deutscheWohnenPrivacyAccepted: true,
};
const contactConfig = {
  incomeTypes: { fieldId: 'einkommensart', isRequired: true },
  incomeAmountTypes: { fieldId: 'monatliches_nettoeinkommen', isRequired: true },
};
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe('buildDeutscheWohnenContact', () => {
  it('uses the authenticated account email and the provider field ids', () => {
    const { body, missingFields } = buildDeutscheWohnenContact(
      profile,
      'applicant@example.com',
      'Guten Tag',
      contactConfig,
    );

    expect(missingFields).toEqual([]);
    expect(body).toEqual({
      firstname: 'Adhithya',
      surename: 'Rajagopal',
      email: 'applicant@example.com',
      telephone: '+49 30 123456',
      message: 'Guten Tag',
      customFields: {
        einkommensart: '1',
        monatliches_nettoeinkommen: 'M_3',
      },
    });
  });

  it('reports every required field without inventing profile facts', () => {
    const { body, missingFields } = buildDeutscheWohnenContact({}, 'not-an-email', '', contactConfig);
    expect(body).toBeNull();
    expect(missingFields).toEqual([
      'name',
      'signedInEmail',
      'phoneNumber',
      'deutscheWohnenIncomeType',
      'deutscheWohnenMonthlyNetIncome',
      'deutscheWohnenPrivacyAccepted',
      'message',
    ]);
  });
});

describe('sendDeutscheWohnenInquiry', () => {
  it('reads live requirements and makes exactly one confirmed POST', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(contactConfig))
      .mockResolvedValueOnce(jsonResponse({ header: 'Vielen Dank', details: 'Anfrage gesendet' }));

    const result = await sendDeutscheWohnenInquiry({
      listing,
      profile,
      accountEmail: 'applicant@example.com',
      message: 'Guten Tag',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('method');
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      email: 'applicant@example.com',
      message: 'Guten Tag',
    });
    expect(result).toMatchObject({ requestId: 'deutscheWohnen:1471120007' });
  });

  it('accepts the provider legacy mail_sent confirmation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(contactConfig))
      .mockResolvedValueOnce(jsonResponse('mail_sent'));

    await expect(
      sendDeutscheWohnenInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).resolves.toMatchObject({ requestId: 'deutscheWohnen:1471120007' });
  });

  it('does not POST when required profile fields are missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(contactConfig));

    await expect(
      sendDeutscheWohnenInquiry({
        listing,
        profile: {},
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ outcome: 'failed', missingFields: expect.arrayContaining(['name', 'phoneNumber']) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a real-send timeout as unknown and never retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(contactConfig))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendDeutscheWohnenInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [422, 'failed'],
    [500, 'unknown'],
  ])('classifies a real-send %s response as %s', async (status, outcome) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(contactConfig))
      .mockResolvedValueOnce(jsonResponse({ error: 'rejected' }, status));

    await expect(
      sendDeutscheWohnenInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ outcome, status });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats an unrecognized 2xx body as unknown', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(contactConfig))
      .mockResolvedValueOnce(jsonResponse({}));

    await expect(
      sendDeutscheWohnenInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
  });
});
