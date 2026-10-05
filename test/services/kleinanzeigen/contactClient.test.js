/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, persistCookies, withSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  persistCookies: vi.fn(),
  withSession: vi.fn((session, options) => ({
    ...options,
    headers: { ...options.headers, Cookie: session.cookieHeader },
  })),
}));

vi.mock('../../../lib/services/kleinanzeigen/sessionClient.js', () => ({
  getKleinanzeigenWebSession: getSession,
  persistKleinanzeigenSessionCookies: persistCookies,
  withKleinanzeigenSession: withSession,
}));

import {
  buildKleinanzeigenContact,
  isKleinanzeigenListing,
  sendKleinanzeigenInquiry,
} from '../../../lib/services/kleinanzeigen/contactClient.js';

const listing = { link: 'https://www.kleinanzeigen.de/s-anzeige/berlin-wohnung/3507935505-203-3483' };
const session = { cookieHeader: 'SESSION=secret' };
const contactHtml = `
  <meta name="_csrf" content="csrf-value">
  <script>ViewAdView.init({ userLoggedIn: true, loggedInUserEmail: 'applicant@example.com' });</script>
  <form id="viewad-contact-form" action="/s-anbieter-kontaktieren.json">
    <input name="adId" value="3507935505">
    <input name="adType" value="OFFER">
    <input name="contactName" value="Alice Example">
    <input name="phoneNumber" value="">
    <textarea class="viewad-contact-message" name="message"></textarea>
  </form>`;
const response = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(session);
  persistCookies.mockReset().mockImplementation(async (current) => current);
  withSession.mockClear();
});

describe('Kleinanzeigen contact form', () => {
  it('recognizes only Kleinanzeigen listing links', () => {
    expect(isKleinanzeigenListing(listing)).toBe(true);
    expect(isKleinanzeigenListing({ link: 'https://example.com/s-anzeige/3507935505' })).toBe(false);
  });

  it('replays the live form controls with authenticated identity and the generated message', () => {
    const result = buildKleinanzeigenContact(contactHtml, listing.link, 'applicant@example.com', 'Guten Tag');

    expect(result.missingFields).toEqual([]);
    expect(result.url).toBe('https://www.kleinanzeigen.de/s-anbieter-kontaktieren.json');
    expect(result.csrf).toBe('csrf-value');
    expect(Object.fromEntries(result.body)).toEqual({
      adId: '3507935505',
      adType: 'OFFER',
      contactName: 'Alice Example',
      phoneNumber: '',
      message: 'Guten Tag',
    });
  });

  it('fails closed for an expired session, wrong account, or empty message', () => {
    expect(
      buildKleinanzeigenContact(
        contactHtml.replace('userLoggedIn: true', 'userLoggedIn: false'),
        listing.link,
        'applicant@example.com',
        'Hi',
      ).missingFields,
    ).toContain('kleinanzeigenSession');
    expect(buildKleinanzeigenContact(contactHtml, listing.link, 'other@example.com', 'Hi').missingFields).toContain(
      'signedInEmail',
    );
    expect(buildKleinanzeigenContact(contactHtml, listing.link, 'applicant@example.com', '').missingFields).toContain(
      'message',
    );
  });
});

describe('sendKleinanzeigenInquiry', () => {
  it('loads the encrypted owner session and performs exactly one confirmed POST', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(contactHtml))
      .mockResolvedValueOnce(response({ status: 'OK', message: 'Nachricht gesendet' }));

    const result = await sendKleinanzeigenInquiry({
      listing,
      userId: 'user-1',
      accountEmail: 'applicant@example.com',
      message: 'Guten Tag',
      fetchImpl,
    });

    expect(getSession).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, options] = fetchImpl.mock.calls[1];
    expect(url).toBe('https://www.kleinanzeigen.de/s-anbieter-kontaktieren.json');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: {
        'X-CSRF-TOKEN': 'csrf-value',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: 'SESSION=secret',
      },
    });
    expect(new URLSearchParams(options.body).get('message')).toBe('Guten Tag');
    expect(result).toMatchObject({ requestId: 'kleinanzeigen:3507935505' });
  });

  it('does not POST when the session does not match the signed-in Fredy email', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(contactHtml));

    await expect(
      sendKleinanzeigenInquiry({
        listing,
        userId: 'user-1',
        accountEmail: 'other@example.com',
        message: 'Guten Tag',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ phase: 'authentication', permanent: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies provider rejection as failed and unrecognized success as unknown', async () => {
    for (const [providerResponse, outcome] of [
      [response({ status: 'ERROR', message: 'rejected' }), 'failed'],
      [response({ status: 'OTHER' }), 'unknown'],
    ]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(response(contactHtml)).mockResolvedValueOnce(providerResponse);
      await expect(
        sendKleinanzeigenInquiry({
          listing,
          userId: 'user-1',
          accountEmail: 'applicant@example.com',
          message: 'Guten Tag',
          fetchImpl,
        }),
      ).rejects.toMatchObject({ outcome });
    }
  });

  it('classifies a timeout after POST as unknown and never retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(contactHtml))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendKleinanzeigenInquiry({
        listing,
        userId: 'user-1',
        accountEmail: 'applicant@example.com',
        message: 'Guten Tag',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
