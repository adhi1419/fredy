/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import { isWbmListing, sendWbmInquiry } from '../../../lib/services/inberlinwohnen/wbmContactClient.js';

const listing = {
  link: 'https://www.wbm.de/wohnungen-berlin/angebote/details/2-zimmer-wohnung-in-spandau-mit-wbs-ab-160-1/',
};
const profile = {
  name: 'Alice Example',
  email: 'profile-must-not-be-used@example.net',
  street: 'Example Street',
  houseNumber: '7',
  postcode: '10178',
  city: 'Berlin',
  phoneNumber: '+49 30 123456',
  salutation: 'Frau',
  wbsAvailable: false,
};
const detailHtml = `
  <form data-powermail-validate="data-powermail-validate"
    action="/wohnungen-berlin/angebote/details/?tx_powermail_pi1%5Baction%5D=create&amp;tx_powermail_pi1%5Bcontroller%5D=Form&amp;cHash=form-hash#c722"
    method="post" enctype="multipart/form-data">
    <input type="hidden" name="tx_powermail_pi1[__referrer][@extension]" value="Powermail">
    <input type="hidden" name="tx_powermail_pi1[__referrer][@controller]" value="Form">
    <input type="hidden" name="tx_powermail_pi1[__referrer][@action]" value="form">
    <input type="hidden" name="tx_powermail_pi1[__trustedProperties]" value="signed-trusted-properties">
    <input type="hidden" name="tx_powermail_pi1[field][objekt]" value="50-518504/11/184">
    <input type="radio" name="tx_powermail_pi1[field][wbsvorhanden]" value="1">
    <input type="radio" name="tx_powermail_pi1[field][wbsvorhanden]" value="0" checked>
    <select name="tx_powermail_pi1[field][anrede]"><option value="Frau" selected>Frau</option><option value="Herr">Herr</option></select>
    <input type="text" name="tx_powermail_pi1[field][name]" required>
    <input type="text" name="tx_powermail_pi1[field][vorname]" required>
    <input type="text" name="tx_powermail_pi1[field][strasse]">
    <input type="text" name="tx_powermail_pi1[field][plz]">
    <input type="text" name="tx_powermail_pi1[field][ort]">
    <input type="text" name="tx_powermail_pi1[field][e_mail]" required>
    <input type="text" name="tx_powermail_pi1[field][telefon]">
    <input type="hidden" name="tx_powermail_pi1[field][datenschutzhinweis]" value="">
    <input type="checkbox" name="tx_powermail_pi1[field][datenschutzhinweis][]" value="1" required>
    <input type="hidden" name="tx_powermail_pi1[mail][form]" value="2">
    <input type="text" name="tx_powermail_pi1[field][__hp]" value="bot-seed-must-be-cleared">
  </form>`;
const successHtml = '<h1>Vielen Dank</h1><p>Wir haben Ihre Anfrage für das Wohnungsangebot erhalten.</p>';
const htmlResponse = (body, status = 200, responseHeaders = {}) =>
  new Response(body, { status, headers: responseHeaders });

function successfulFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(htmlResponse(detailHtml))
    .mockResolvedValueOnce(
      htmlResponse('', 303, {
        Location: 'https://www.wbm.de/wohnungen-berlin/angebote/vielen-dank/',
      }),
    );
}

describe('WBM inquiry delivery', () => {
  it('recognizes WBM partner links only', () => {
    expect(isWbmListing(listing)).toBe(true);
    expect(isWbmListing({ link: 'https://www.howoge.de/wohnungen/test' })).toBe(false);
  });

  it('loads the fresh Powermail form and sends the exact multipart contract', async () => {
    const fetchImpl = successfulFetch();

    const result = await sendWbmInquiry({
      listing,
      profile,
      accountEmail: 'applicant@example.com',
      message: 'WBM has no message field',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(listing.link);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(fetchImpl.mock.calls[1][1].headers['Content-Type']).toBeUndefined();

    const body = fetchImpl.mock.calls[1][1].body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('tx_powermail_pi1[__trustedProperties]')).toBe('signed-trusted-properties');
    expect(body.get('tx_powermail_pi1[field][name]')).toBe('Example');
    expect(body.get('tx_powermail_pi1[field][vorname]')).toBe('Alice');
    expect(body.get('tx_powermail_pi1[field][e_mail]')).toBe('applicant@example.com');
    expect(body.get('tx_powermail_pi1[field][anrede]')).toBe('Frau');
    expect(body.get('tx_powermail_pi1[field][wbsvorhanden]')).toBe('0');
    expect(body.get('tx_powermail_pi1[field][wbszimmeranzahl]')).toBeNull();
    expect(body.get('tx_powermail_pi1[field][strasse]')).toBe('Example Street 7');
    expect(body.get('tx_powermail_pi1[field][datenschutzhinweis][]')).toBe('1');
    expect([...body.keys()].some((key) => /message/i.test(key))).toBe(false);
    expect(result).toMatchObject({ requestId: 'wbm:50-518504/11/184' });
  });

  it('does not POST when authenticated identity or required consent is missing', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(htmlResponse(detailHtml));

    await expect(
      sendWbmInquiry({
        listing,
        profile: { name: 'Alice Example' },
        accountEmail: 'not-an-email',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      outcome: 'failed',
      missingFields: expect.arrayContaining(['signedInEmail', 'salutation', 'wbsAvailable']),
      permanent: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('always clears the Powermail honeypot, even if the fetched markup contains a value', async () => {
    const fetchImpl = successfulFetch();

    await sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl });

    const body = fetchImpl.mock.calls[1][1].body;
    expect(body.get('tx_powermail_pi1[field][__hp]')).toBe('');
  });

  it('accepts only WBM’s exact confirmation redirect as success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse('', 303, { Location: 'https://www.wbm.de/wohnungen-berlin/angebote/' }));

    await expect(
      sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
    ).rejects.toMatchObject({
      outcome: 'unknown',
    });
  });

  it('accepts the exact confirmation body when the POST response is not redirected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse(successHtml));

    await expect(
      sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
    ).resolves.toMatchObject({
      requestId: 'wbm:50-518504/11/184',
    });
  });

  it('classifies provider rejection as failed without exposing provider response text', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse('private provider details applicant@example.com', 422));

    await expect(
      sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
    ).rejects.toSatisfy((error) => {
      expect(error).toMatchObject({ outcome: 'failed', status: 422 });
      expect(error.message).not.toContain('private provider details');
      expect(error.message).not.toContain('applicant@example.com');
      return true;
    });
  });

  it('classifies a POST timeout as unknown and never retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl, timeoutMs: 5 }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('classifies an unrecognized 2xx response and a 5xx response as unknown', async () => {
    for (const response of [htmlResponse('<h1>Formular</h1>'), htmlResponse('server failure', 503)]) {
      const fetchImpl = vi.fn().mockResolvedValueOnce(htmlResponse(detailHtml)).mockResolvedValueOnce(response);

      await expect(
        sendWbmInquiry({ listing, profile, accountEmail: 'applicant@example.com', fetchImpl }),
      ).rejects.toMatchObject({
        outcome: 'unknown',
      });
    }
  });
});
