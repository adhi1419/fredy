/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { load } from 'cheerio';
import { InquiryDeliveryError } from '../inquiries/errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WBM_HOSTS = new Set(['wbm.de', 'www.wbm.de']);
const SUCCESS_PATH = '/wohnungen-berlin/angebote/vielen-dank/';
const SUCCESS_MARKER = 'Wir haben Ihre Anfrage für das Wohnungsangebot erhalten.';
const headers = {
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

const fields = Object.freeze({
  trustedProperties: 'tx_powermail_pi1[__trustedProperties]',
  object: 'tx_powermail_pi1[field][objekt]',
  salutation: 'tx_powermail_pi1[field][anrede]',
  wbsAvailable: 'tx_powermail_pi1[field][wbsvorhanden]',
  wbsValidUntil: 'tx_powermail_pi1[field][wbsgueltigbis]',
  wbsMaxRooms: 'tx_powermail_pi1[field][wbszimmeranzahl]',
  wbsIncomeLimit: 'tx_powermail_pi1[field][einkommensgrenzenacheinkommensbescheinigung9]',
  wbsSpecialNeed: 'tx_powermail_pi1[field][wbsmitbesonderemwohnbedarf][]',
  lastName: 'tx_powermail_pi1[field][name]',
  firstName: 'tx_powermail_pi1[field][vorname]',
  street: 'tx_powermail_pi1[field][strasse]',
  postcode: 'tx_powermail_pi1[field][plz]',
  city: 'tx_powermail_pi1[field][ort]',
  email: 'tx_powermail_pi1[field][e_mail]',
  phone: 'tx_powermail_pi1[field][telefon]',
  privacy: 'tx_powermail_pi1[field][datenschutzhinweis][]',
  honeypot: 'tx_powermail_pi1[field][__hp]',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validatedWbmUrl(value, baseUrl, label) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === 'https:' && WBM_HOSTS.has(url.hostname.toLowerCase())) return url.href;
  } catch {
    // Report the same safe provider error below.
  }
  throw new InquiryDeliveryError(`The WBM ${label} URL is invalid.`, {
    outcome: 'failed',
    missingFields: ['applicationForm'],
    permanent: true,
  });
}

/**
 * Whether an InBerlinWohnen listing links to WBM's Powermail inquiry form.
 *
 * @param {Object|null|undefined} listing
 * @returns {boolean}
 */
export function isWbmListing(listing) {
  try {
    const url = new URL(listing?.link);
    return url.protocol === 'https:' && WBM_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function splitName(value) {
  const parts = text(value).split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : null;
}

function hasField(form, $, name) {
  return form.find('input, select, textarea').filter((_, element) => $(element).attr('name') === name).length > 0;
}

function appendFormControls(form, $, body) {
  form.find('input[name], select[name], textarea[name]').each((_, element) => {
    const name = $(element).attr('name');
    const type = ($(element).attr('type') || '').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') return;

    if (type === 'radio' || type === 'checkbox') {
      if ($(element).is(':checked') || $(element).attr('checked') != null)
        body.append(name, $(element).attr('value') ?? '');
      return;
    }
    if (element.tagName.toLowerCase() === 'select') {
      const selected = $(element).find('option[selected]').first();
      const option = selected.length > 0 ? selected : $(element).find('option').first();
      body.append(name, option.attr('value') ?? option.text());
      return;
    }
    body.append(name, $(element).attr('value') ?? $(element).text());
  });
}

function setIfPresent(form, $, body, name, value) {
  if (hasField(form, $, name)) body.set(name, value);
}

/**
 * Build a WBM Powermail multipart body from a freshly fetched listing form.
 *
 * @param {string} html
 * @param {string} listingUrl
 * @param {Object} profile
 * @param {string} accountEmail Authenticated Fredy login email.
 * @returns {{actionUrl: string|null, body: FormData|null, objectId: string|null, missingFields: string[]}}
 */
export function buildWbmSubmission(html, listingUrl, profile, accountEmail) {
  const $ = load(html);
  const form = $('form[data-powermail-validate], form.powermail_form').first();
  const missingFields = [];
  const name = splitName(profile?.name);
  const email = text(accountEmail);
  const action = form.attr('action');

  if (form.length === 0 || !action || form.attr('method')?.toLowerCase() !== 'post')
    missingFields.push('applicationForm');
  if (form.length > 0 && form.attr('enctype')?.toLowerCase() !== 'multipart/form-data')
    missingFields.push('multipartForm');
  if (!hasField(form, $, fields.trustedProperties)) missingFields.push('trustedProperties');
  if (!hasField(form, $, fields.lastName)) missingFields.push('name');
  if (!hasField(form, $, fields.firstName)) missingFields.push('name');
  if (!hasField(form, $, fields.email)) missingFields.push('signedInEmail');
  if (!hasField(form, $, fields.privacy)) missingFields.push('applicationForm');
  if (!name) missingFields.push('name');
  if (!EMAIL_PATTERN.test(email)) missingFields.push('signedInEmail');
  if (!text(profile?.salutation)) missingFields.push('salutation');
  if (typeof profile?.wbsAvailable !== 'boolean') missingFields.push('wbsAvailable');
  if (profile?.wbsAvailable === true) {
    if (!text(profile?.wbsValidUntil)) missingFields.push('wbsValidUntil');
    if (!text(profile?.wbsMaxRooms)) missingFields.push('wbsMaxRooms');
    if (!text(profile?.wbsIncomeLimit)) missingFields.push('wbsIncomeLimit');
    if (typeof profile?.wbsSpecialNeed !== 'boolean') missingFields.push('wbsSpecialNeed');
  }

  const uniqueMissingFields = [...new Set(missingFields)];
  if (uniqueMissingFields.length > 0) {
    return { actionUrl: null, body: null, objectId: null, missingFields: uniqueMissingFields };
  }

  const actionUrl = validatedWbmUrl(action, listingUrl, 'submission');
  const body = new FormData();
  appendFormControls(form, $, body);

  setIfPresent(form, $, body, fields.lastName, name.lastName);
  setIfPresent(form, $, body, fields.firstName, name.firstName);
  setIfPresent(form, $, body, fields.email, email);
  setIfPresent(form, $, body, fields.salutation, text(profile.salutation));
  setIfPresent(form, $, body, fields.privacy, '1');
  setIfPresent(form, $, body, fields.honeypot, '');

  setIfPresent(form, $, body, fields.wbsAvailable, profile.wbsAvailable ? '1' : '0');
  if (profile.wbsAvailable) {
    setIfPresent(form, $, body, fields.wbsValidUntil, text(profile.wbsValidUntil));
    setIfPresent(form, $, body, fields.wbsMaxRooms, text(profile.wbsMaxRooms));
    setIfPresent(form, $, body, fields.wbsIncomeLimit, text(profile.wbsIncomeLimit));
    if (profile.wbsSpecialNeed) setIfPresent(form, $, body, fields.wbsSpecialNeed, '1');
    else body.delete(fields.wbsSpecialNeed);
  } else {
    for (const field of [fields.wbsValidUntil, fields.wbsMaxRooms, fields.wbsIncomeLimit, fields.wbsSpecialNeed]) {
      body.delete(field);
    }
  }

  const street = [text(profile?.street), text(profile?.houseNumber)].filter(Boolean).join(' ');
  setIfPresent(form, $, body, fields.street, street);
  setIfPresent(form, $, body, fields.postcode, text(profile?.postcode));
  setIfPresent(form, $, body, fields.city, text(profile?.city));
  setIfPresent(form, $, body, fields.phone, text(profile?.phoneNumber));

  return {
    actionUrl,
    body,
    objectId: text(body.get(fields.object)) || null,
    missingFields: [],
  };
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

function successLocation(location, actionUrl) {
  if (!location) return false;
  try {
    const target = new URL(location, actionUrl);
    return (
      target.protocol === 'https:' && WBM_HOSTS.has(target.hostname.toLowerCase()) && target.pathname === SUCCESS_PATH
    );
  } catch {
    return false;
  }
}

function successBody(html) {
  const $ = load(html);
  const heading = $('h1').filter((_, element) => text($(element).text()) === 'Vielen Dank').length > 0;
  const marker = $('p').filter((_, element) => text($(element).text()) === SUCCESS_MARKER).length > 0;
  return heading && marker;
}

/**
 * Submit one WBM inquiry without a browser session.
 *
 * WBM has no custom-message field. Fredy sends only fields present in the freshly fetched form,
 * uses the authenticated account email rather than any profile email, and keeps the Powermail
 * honeypot empty. A timeout, network error, 5xx, or unrecognized response after POST is unknown;
 * the POST is never retried automatically.
 *
 * @param {{listing: Object, profile: Object, accountEmail: string, message?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendWbmInquiry({ listing, profile, accountEmail, fetchImpl = fetch, timeoutMs = 30_000 }) {
  if (!isWbmListing(listing)) {
    throw new InquiryDeliveryError('This InBerlinWohnen partner does not support automatic applications.', {
      outcome: 'failed',
      missingFields: ['supportedPartner'],
      permanent: true,
    });
  }
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;
  const listingUrl = new URL(listing.link).href;

  let formHtml;
  let formResponse;
  try {
    formResponse = await fetchWithTimeout(fetchImpl, listingUrl, { headers }, requestTimeoutMs);
    if (!formResponse.ok) {
      throw new InquiryDeliveryError('Could not load the WBM listing form.', {
        outcome: 'failed',
        status: formResponse.status,
      });
    }
    formHtml = await formResponse.text();
  } catch (error) {
    if (error instanceof InquiryDeliveryError) throw error;
    throw new InquiryDeliveryError('Could not load the WBM listing form.', { outcome: 'failed', cause: error });
  }

  const { actionUrl, body, objectId, missingFields } = buildWbmSubmission(formHtml, listingUrl, profile, accountEmail);
  if (missingFields.length > 0) {
    throw new InquiryDeliveryError('Required WBM inquiry fields are missing.', {
      outcome: 'failed',
      missingFields,
      permanent: true,
    });
  }

  let sendResponse;
  try {
    sendResponse = await fetchWithTimeout(
      fetchImpl,
      actionUrl,
      {
        method: 'POST',
        redirect: 'manual',
        headers: { ...headers, Referer: listingUrl },
        body,
      },
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', { outcome: 'unknown', cause: error });
  }

  if (sendResponse.status >= 500) {
    throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', {
      outcome: 'unknown',
      status: sendResponse.status,
    });
  }
  if (sendResponse.status >= 400) {
    throw new InquiryDeliveryError('WBM rejected the inquiry.', { outcome: 'failed', status: sendResponse.status });
  }

  if (sendResponse.status >= 300 && sendResponse.status < 400) {
    if (!successLocation(sendResponse.headers.get('location'), actionUrl)) {
      throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', { outcome: 'unknown' });
    }
  } else if (sendResponse.status >= 200 && sendResponse.status < 300) {
    let responseHtml;
    try {
      responseHtml = await sendResponse.text();
    } catch (error) {
      throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', { outcome: 'unknown', cause: error });
    }
    if (!successBody(responseHtml)) {
      throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', { outcome: 'unknown' });
    }
  } else {
    throw new InquiryDeliveryError('The WBM inquiry outcome is unknown.', { outcome: 'unknown' });
  }

  return {
    requestId: `wbm:${objectId || new URL(listingUrl).pathname.split('/').filter(Boolean).pop()}`,
    sentAt: Date.now(),
  };
}
