/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { load } from 'cheerio';
import { InquiryDeliveryError } from '../inquiries/errors.js';
import {
  getKleinanzeigenWebSession,
  persistKleinanzeigenSessionCookies,
  withKleinanzeigenSession,
} from './sessionClient.js';

const HOSTS = new Set(['kleinanzeigen.de', 'www.kleinanzeigen.de']);
const BASE_URL = 'https://www.kleinanzeigen.de';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function isKleinanzeigenListing(listing) {
  try {
    const url = new URL(listing?.link);
    return url.protocol === 'https:' && HOSTS.has(url.hostname.toLowerCase()) && /\/s-anzeige\//.test(url.pathname);
  } catch {
    return false;
  }
}

function adIdOf(listing) {
  const match = new URL(listing.link).pathname.match(/\/(\d{8,})(?:-|\/|$)/);
  if (!match) {
    throw new InquiryDeliveryError('The listing does not contain a Kleinanzeigen ad id.', {
      permanent: true,
      missingFields: ['adId'],
    });
  }
  return match[1];
}

function accountFromHtml(html) {
  const loggedIn = /\buserLoggedIn\s*:\s*true\b/.test(html);
  const emailMatch = html.match(/\bloggedInUserEmail\s*:\s*(['"])(.*?)\1/);
  return { loggedIn, email: text(emailMatch?.[2]).toLowerCase() };
}

function appendControls(form, $, body) {
  form.find('input[name], select[name], textarea[name]').each((_, element) => {
    const control = $(element);
    const name = control.attr('name');
    const type = (control.attr('type') ?? '').toLowerCase();
    if (!name || ['submit', 'button', 'reset', 'file'].includes(type)) return;
    if (['checkbox', 'radio'].includes(type) && !control.is(':checked')) return;
    if (element.tagName.toLowerCase() === 'select') {
      const selected = control.find('option[selected]').first();
      const option = selected.length > 0 ? selected : control.find('option').first();
      body.append(name, option.attr('value') ?? option.text());
      return;
    }
    body.append(name, control.attr('value') ?? control.text());
  });
}

export function buildKleinanzeigenContact(html, listingUrl, accountEmail, message) {
  const $ = load(html);
  const account = accountFromHtml(html);
  const expectedEmail = text(accountEmail).toLowerCase();
  const missingFields = [];
  if (!account.loggedIn) missingFields.push('kleinanzeigenSession');
  if (!EMAIL_PATTERN.test(expectedEmail) || account.email !== expectedEmail) missingFields.push('signedInEmail');

  const form = $('form#viewad-contact-form, form#viewad-contact-modal-form')
    .filter((_, element) => $(element).attr('action')?.includes('/s-anbieter-kontaktieren.json'))
    .first();
  const csrf = text($('meta[name="_csrf"]').attr('content'));
  const action = form.attr('action');
  const messageControl = form.find('textarea.viewad-contact-message, textarea[name*="message" i]').first();
  if (form.length === 0 || !action) missingFields.push('applicationForm');
  if (!csrf) missingFields.push('csrfToken');
  if (messageControl.length === 0 || !text(message)) missingFields.push('message');

  const uniqueMissing = [...new Set(missingFields)];
  if (uniqueMissing.length > 0) return { url: null, body: null, csrf: null, missingFields: uniqueMissing };

  const target = new URL(action, listingUrl);
  if (target.origin !== BASE_URL || target.pathname !== '/s-anbieter-kontaktieren.json') {
    return { url: null, body: null, csrf: null, missingFields: ['applicationForm'] };
  }

  const body = new URLSearchParams();
  appendControls(form, $, body);
  body.set(messageControl.attr('name'), text(message));
  return { url: target.href, body, csrf, missingFields: [] };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function sendKleinanzeigenInquiry({
  listing,
  userId,
  accountEmail,
  message,
  fetchImpl = fetch,
  credentialStore,
  timeoutMs = 30_000,
}) {
  if (!isKleinanzeigenListing(listing)) {
    throw new InquiryDeliveryError('This is not a supported Kleinanzeigen listing.', { permanent: true });
  }
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;
  const listingUrl = new URL(listing.link).href;
  const adId = adIdOf(listing);
  let session = await getKleinanzeigenWebSession({ userId, ...(credentialStore ? { credentialStore } : {}) });

  let listingResponse;
  try {
    listingResponse = await fetchWithTimeout(
      fetchImpl,
      listingUrl,
      withKleinanzeigenSession(session, {
        redirect: 'manual',
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
      }),
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('Could not load the authenticated Kleinanzeigen contact form.', {
      outcome: 'failed',
      phase: 'authentication',
      cause: error,
    });
  }
  session = await persistKleinanzeigenSessionCookies(session, listingResponse);
  if (!listingResponse.ok) {
    throw new InquiryDeliveryError('Could not load the authenticated Kleinanzeigen contact form.', {
      outcome: 'failed',
      phase: 'authentication',
      status: listingResponse.status,
    });
  }

  const html = await listingResponse.text();
  const contact = buildKleinanzeigenContact(html, listingUrl, accountEmail, message);
  if (contact.missingFields.length > 0) {
    throw new InquiryDeliveryError('Kleinanzeigen account or contact fields are incomplete.', {
      outcome: 'failed',
      phase: 'authentication',
      missingFields: contact.missingFields,
      permanent: contact.missingFields.some((field) => field !== 'kleinanzeigenSession'),
    });
  }

  let sendResponse;
  try {
    sendResponse = await fetchWithTimeout(
      fetchImpl,
      contact.url,
      withKleinanzeigenSession(session, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: BASE_URL,
          Referer: listingUrl,
          'User-Agent': USER_AGENT,
          'X-CSRF-TOKEN': contact.csrf,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: contact.body.toString(),
      }),
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('The Kleinanzeigen inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }
  await persistKleinanzeigenSessionCookies(session, sendResponse);
  if (sendResponse.status >= 500) {
    throw new InquiryDeliveryError('The Kleinanzeigen inquiry outcome is unknown.', {
      outcome: 'unknown',
      status: sendResponse.status,
    });
  }

  const result = await responseJson(sendResponse);
  if (!sendResponse.ok || result.status === 'ERROR' || result.status === 'NOT_AUTHENTICATED') {
    throw new InquiryDeliveryError('Kleinanzeigen rejected the inquiry.', {
      outcome: 'failed',
      status: sendResponse.status,
      phase: result.status === 'NOT_AUTHENTICATED' ? 'authentication' : 'send',
    });
  }
  if (result.status !== 'OK') {
    throw new InquiryDeliveryError('The Kleinanzeigen inquiry outcome is unknown.', { outcome: 'unknown' });
  }

  return { requestId: `kleinanzeigen:${adId}`, sentAt: Date.now() };
}
