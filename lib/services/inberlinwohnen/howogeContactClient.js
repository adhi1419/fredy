/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { load } from 'cheerio';
import { InquiryDeliveryError } from '../inquiries/errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOWOGE_HOSTS = new Set(['howoge.de', 'www.howoge.de']);
const headers = {
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

/**
 * Whether an InBerlinWohnen listing links to HOWOGE's known DOI workflow.
 *
 * @param {Object|null|undefined} listing
 * @returns {boolean}
 */
export function isHowogeListing(listing) {
  try {
    const url = new URL(listing?.link);
    return url.protocol === 'https:' && HOWOGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function validatedHowogeUrl(value, baseUrl, label) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === 'https:' && HOWOGE_HOSTS.has(url.hostname.toLowerCase())) return url.href;
  } catch {
    // Report the same safe provider error below.
  }
  throw new InquiryDeliveryError(`The HOWOGE ${label} URL is invalid.`, {
    outcome: 'failed',
    missingFields: ['applicationForm'],
  });
}

function splitName(value) {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean) : [];
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : null;
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

async function responseText(response) {
  return response.text();
}

function applicationUrlFromDetail(html, detailUrl) {
  const $ = load(html);
  const href = $('a[href*="tx_howrealestate_visitform"][href*="showVisitForm"][href*="obid"]').first().attr('href');
  if (!href) {
    throw new InquiryDeliveryError('This HOWOGE listing has no application form.', {
      outcome: 'failed',
      missingFields: ['applicationForm'],
    });
  }
  return validatedHowogeUrl(href, detailUrl, 'application form');
}

function buildSubmission(html, applicationUrl, profile, accountEmail) {
  const $ = load(html);
  const form = $('#show-visit-form').first();
  const action = form.attr('action');
  const name = splitName(profile?.name);
  const email = typeof accountEmail === 'string' ? accountEmail : '';
  const missingFields = [];

  if (!action) missingFields.push('applicationForm');
  if (!name) missingFields.push('name');
  if (!EMAIL_PATTERN.test(email)) missingFields.push('signedInEmail');
  if (profile?.howogeApplicationAccepted !== true) missingFields.push('howogeApplicationAccepted');
  if (missingFields.length > 0) return { actionUrl: null, body: null, missingFields };

  const body = new URLSearchParams();
  form.find('input[type="hidden"][name]').each((_, input) => {
    body.append($(input).attr('name'), $(input).attr('value') ?? '');
  });
  body.set('tx_howrealestate_visitform[visitRequest][firstName]', name.firstName);
  body.set('tx_howrealestate_visitform[visitRequest][lastName]', name.lastName);
  body.set('tx_howrealestate_visitform[visitRequest][email]', email);

  return {
    actionUrl: validatedHowogeUrl(action, applicationUrl, 'submission'),
    body,
    missingFields,
  };
}

function howogeObjectId(applicationHtml) {
  const $ = load(applicationHtml);
  return $('#show-visit-form input[name="tx_howrealestate_visitform[visitRequest][immoobject]"]').attr('value');
}

function acceptedRedirect(location, actionUrl) {
  if (!location) return false;
  try {
    const target = new URL(location, actionUrl);
    return (
      target.protocol === 'https:' &&
      HOWOGE_HOSTS.has(target.hostname.toLowerCase()) &&
      target.pathname !== '/' &&
      target.pathname !== ''
    );
  } catch {
    return false;
  }
}

/**
 * Start HOWOGE's double-opt-in application flow for one InBerlinWohnen listing.
 *
 * HOWOGE accepts no custom message. Per product policy, a server-accepted DOI request counts as
 * Applied; the applicant still receives HOWOGE's confirmation email. Fresh TYPO3 trusted-property
 * hashes and the internal object id are copied from the live form. The POST is attempted once only.
 *
 * @param {{listing: Object, profile: Object, accountEmail: string, fetchImpl?: typeof fetch, timeoutMs?: number}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendHowogeInquiry({ listing, profile, accountEmail, fetchImpl = fetch, timeoutMs = 30_000 }) {
  if (!isHowogeListing(listing)) {
    throw new InquiryDeliveryError('This InBerlinWohnen partner does not support automatic applications.', {
      outcome: 'failed',
      missingFields: ['supportedPartner'],
    });
  }
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;

  let detailHtml;
  try {
    const response = await fetchWithTimeout(fetchImpl, listing.link, { headers }, requestTimeoutMs);
    if (!response.ok) {
      throw new InquiryDeliveryError('Could not load the HOWOGE listing.', {
        outcome: 'failed',
        status: response.status,
      });
    }
    detailHtml = await responseText(response);
  } catch (error) {
    if (error instanceof InquiryDeliveryError) throw error;
    throw new InquiryDeliveryError('Could not load the HOWOGE listing.', { outcome: 'failed', cause: error });
  }

  const applicationUrl = applicationUrlFromDetail(detailHtml, listing.link);
  let applicationHtml;
  try {
    const response = await fetchWithTimeout(fetchImpl, applicationUrl, { headers }, requestTimeoutMs);
    if (!response.ok) {
      throw new InquiryDeliveryError('Could not load the HOWOGE application form.', {
        outcome: 'failed',
        status: response.status,
      });
    }
    applicationHtml = await responseText(response);
  } catch (error) {
    if (error instanceof InquiryDeliveryError) throw error;
    throw new InquiryDeliveryError('Could not load the HOWOGE application form.', {
      outcome: 'failed',
      cause: error,
    });
  }

  const { actionUrl, body, missingFields } = buildSubmission(applicationHtml, applicationUrl, profile, accountEmail);
  if (missingFields.length > 0) {
    throw new InquiryDeliveryError('Required HOWOGE application fields are missing.', {
      outcome: 'failed',
      missingFields,
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
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: applicationUrl,
        },
        body: body.toString(),
      },
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('The HOWOGE application outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }

  if (sendResponse.status >= 500) {
    throw new InquiryDeliveryError('The HOWOGE application outcome is unknown.', {
      outcome: 'unknown',
      status: sendResponse.status,
    });
  }
  if (sendResponse.status >= 400) {
    throw new InquiryDeliveryError('HOWOGE rejected the application.', {
      outcome: 'failed',
      status: sendResponse.status,
    });
  }
  if (!(sendResponse.status === 303 && acceptedRedirect(sendResponse.headers.get('location'), actionUrl))) {
    throw new InquiryDeliveryError('The HOWOGE application outcome is unknown.', { outcome: 'unknown' });
  }

  const objectId = howogeObjectId(applicationHtml);
  return {
    requestId: `howoge:${objectId || new URL(listing.link).pathname.split('/').pop()}`,
    sentAt: Date.now(),
  };
}
