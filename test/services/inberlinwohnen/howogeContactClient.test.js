/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import { isHowogeListing, sendHowogeInquiry } from '../../../lib/services/inberlinwohnen/howogeContactClient.js';

const listing = {
  link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html?t=ibw',
};
const profile = {
  name: 'Alice Example',
  email: 'attacker-controlled@example.net',
  howogeApplicationAccepted: true,
};
const applicationPath =
  '/immobiliensuche/wohnungssuche/besichtigung-vereinbaren/bewerbungsprozess.html?tx_howrealestate_visitform%5Baction%5D=showVisitForm&tx_howrealestate_visitform%5Bcontroller%5D=Immoobject&tx_howrealestate_visitform%5Bobid%5D=1770-20776-16&cHash=detail-hash';
const detailHtml = `<a href="${applicationPath}">Besichtigung anfragen</a>`;
const applicationHtml = `
  <form id="show-visit-form"
    action="/immobiliensuche/wohnungssuche/besichtigung-vereinbaren/bewerbungsprozess.html?tx_howrealestate_visitform%5Baction%5D=doiSend&amp;tx_howrealestate_visitform%5Bcontroller%5D=Immoobject&amp;cHash=send-hash">
    <input type="hidden" name="tx_howrealestate_visitform[__trustedProperties]" value="signed-properties">
    <input type="hidden" name="tx_howrealestate_visitform[visitRequest][immoobject]" value="9454">
    <input name="tx_howrealestate_visitform[visitRequest][firstName]">
    <input name="tx_howrealestate_visitform[visitRequest][lastName]">
    <input name="tx_howrealestate_visitform[visitRequest][email]">
  </form>`;
const htmlResponse = (body, status = 200, responseHeaders = {}) =>
  new Response(body, { status, headers: responseHeaders });

function successfulFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(htmlResponse(detailHtml))
    .mockResolvedValueOnce(htmlResponse(applicationHtml))
    .mockResolvedValueOnce(
      htmlResponse('', 303, {
        Location: '/immobiliensuche/wohnungssuche/besichtigung-vereinbaren/bewerbungsprozess/doi.html?request=accepted',
      }),
    );
}

describe('HOWOGE inquiry delivery', () => {
  it('recognizes HOWOGE partner links only', () => {
    expect(isHowogeListing(listing)).toBe(true);
    expect(isHowogeListing({ link: 'https://www.degewo.de/immobilien/test' })).toBe(false);
  });

  it('replays the fresh signed form with authenticated identity and no generated message', async () => {
    const fetchImpl = successfulFetch();

    const result = await sendHowogeInquiry({
      listing,
      profile,
      accountEmail: 'applicant@example.com',
      message: 'This message cannot be sent by HOWOGE',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, options] = fetchImpl.mock.calls[2];
    expect(url).toContain('action%5D=doiSend');
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual' });
    const body = new URLSearchParams(options.body);
    expect(body.get('tx_howrealestate_visitform[__trustedProperties]')).toBe('signed-properties');
    expect(body.get('tx_howrealestate_visitform[visitRequest][firstName]')).toBe('Alice');
    expect(body.get('tx_howrealestate_visitform[visitRequest][lastName]')).toBe('Example');
    expect(body.get('tx_howrealestate_visitform[visitRequest][email]')).toBe('applicant@example.com');
    expect([...body.keys()].some((key) => /message/i.test(key))).toBe(false);
    expect(result).toMatchObject({ requestId: 'howoge:9454' });
  });

  it('does not POST without explicit HOWOGE consent', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse(applicationHtml));

    await expect(
      sendHowogeInquiry({
        listing,
        profile: { name: 'Alice Example' },
        accountEmail: 'applicant@example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      outcome: 'failed',
      missingFields: ['howogeApplicationAccepted'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not treat an HTTP 200 form response as confirmed delivery', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse(applicationHtml))
      .mockResolvedValueOnce(htmlResponse(applicationHtml));

    await expect(
      sendHowogeInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('classifies a timeout after the real POST starts as unknown without retrying', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(detailHtml))
      .mockResolvedValueOnce(htmlResponse(applicationHtml))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

    await expect(
      sendHowogeInquiry({
        listing,
        profile,
        accountEmail: 'applicant@example.com',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects other InBerlinWohnen partner hosts before making requests', async () => {
    const fetchImpl = vi.fn();
    await expect(
      sendHowogeInquiry({
        listing: { link: 'https://www.degewo.de/immobilien/test' },
        profile,
        accountEmail: 'applicant@example.com',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ outcome: 'failed', missingFields: ['supportedPartner'] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
