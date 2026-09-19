/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import { buildContactForm, sendImmoscoutInquiry } from '../../../lib/services/immoscout/contactClient.js';

const listing = { link: 'https://www.immobilienscout24.de/expose/170874105' };
const profile = {
  name: 'Adhithya Rajagopal',
  email: 'attacker-controlled@example.net',
  street: 'Bredowstr.',
  houseNumber: '25',
  postcode: '10551',
  city: 'Berlin',
  immoscoutPrivacyAccepted: true,
};
const detail = {
  contact: {
    mailButtonState: 'active',
    premiumProfileRequiredForContacting: 'false',
    contactData: {
      realEstateType: 'apartmentrent',
      isTenantNetwork: false,
      formFieldConfig: {
        firstnameField: 'MANDATORY',
        lastnameField: 'MANDATORY',
        emailAddressField: 'MANDATORY',
        addressField: 'MANDATORY',
      },
    },
  },
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

describe('buildContactForm', () => {
  it('uses only applicant facts that were supplied', () => {
    const { form, missingFields } = buildContactForm(profile, 'Hallo', detail.contact.contactData.formFieldConfig, {
      accountEmail: 'applicant@example.com',
    });
    expect(missingFields).toEqual([]);
    expect(form).toMatchObject({
      firstname: 'Adhithya',
      lastname: 'Rajagopal',
      emailAddress: 'applicant@example.com',
      message: 'Hallo',
      privacyPolicyAccepted: true,
      sendProfile: false,
    });
    expect(form.employmentRelationship).toBeUndefined();
    expect(form.income).toBeUndefined();
  });

  it('reports every mandatory field that the profile cannot satisfy', () => {
    const config = {
      ...detail.contact.contactData.formFieldConfig,
      incomeField: 'MANDATORY',
      numberOfPersonsField: 'MANDATORY',
    };
    const { missingFields } = buildContactForm({ name: 'OnlyOneName' }, '', config);
    expect(missingFields).toEqual(
      expect.arrayContaining([
        'name',
        'signedInEmail',
        'address',
        'income',
        'numberOfPersons',
        'immoscoutPrivacyAccepted',
      ]),
    );
  });
});

describe('sendImmoscoutInquiry', () => {
  it('validates with doNotSend before making exactly one real send attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'request-1' }));

    const result = await sendImmoscoutInquiry({
      listing,
      profile,
      accountEmail: 'applicant@example.com',
      message: 'Hallo',
      fetchImpl,
    });

    expect(result.requestId).toBe('request-1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).doNotSend).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).doNotSend).toBe(false);
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBeUndefined();
  });

  it('does not POST when mandatory profile fields are missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(detail));
    await expect(
      sendImmoscoutInquiry({
        listing,
        profile: {},
        accountEmail: 'applicant@example.com',
        message: 'Hallo',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      missingFields: expect.arrayContaining(['name', 'address']),
      outcome: 'failed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('marks a network failure during the real request as unknown and never retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
      .mockRejectedValueOnce(new Error('socket closed'));

    await expect(
      sendImmoscoutInquiry({ listing, profile, accountEmail: 'applicant@example.com', message: 'Hallo', fetchImpl }),
    ).rejects.toMatchObject({
      outcome: 'unknown',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats a successful response without a request id as unknown', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }));

    await expect(
      sendImmoscoutInquiry({ listing, profile, accountEmail: 'applicant@example.com', message: 'Hallo', fetchImpl }),
    ).rejects.toMatchObject({
      outcome: 'unknown',
    });
  });

  it('treats a response-body read failure after the real request as unknown', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => Promise.reject(new Error('body lost')) });

    await expect(
      sendImmoscoutInquiry({ listing, profile, accountEmail: 'applicant@example.com', message: 'Hallo', fetchImpl }),
    ).rejects.toMatchObject({
      outcome: 'unknown',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('aborts a hung real request and classifies the outcome as unknown', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendImmoscoutInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Hallo',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('aborts a hung validation request as failed without attempting a real send', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendImmoscoutInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Hallo',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ outcome: 'failed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears request timeout timers after successful responses', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(detail))
        .mockResolvedValueOnce(jsonResponse({ confirmationScreen: 'saveSearch' }))
        .mockResolvedValueOnce(
          jsonResponse({
            confirmationScreen: 'messageSent',
            id: 'request-123',
          }),
        );

      await sendImmoscoutInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        message: 'Hallo',
        fetchImpl,
        timeoutMs: 5,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies a real-send 4xx as failed and a 5xx as unknown', async () => {
    for (const [status, outcome] of [
      [400, 'failed'],
      [503, 'unknown'],
    ]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(detail))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({}, status));
      await expect(
        sendImmoscoutInquiry({ listing, profile, accountEmail: 'applicant@example.com', message: 'Hallo', fetchImpl }),
      ).rejects.toMatchObject({
        status,
        outcome,
      });
    }
  });
});
