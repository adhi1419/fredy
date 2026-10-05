/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { load } from 'cheerio';
import { InquiryDeliveryError } from '../inquiries/errors.js';
import { extractNumber } from '../../utils/extract-number.js';

const STADT_UND_LAND_HOSTS = new Set(['stadtundland.de', 'www.stadtundland.de']);
const WOHNUNGSHELDEN_HOST = 'app.wohnungshelden.de';
const WOHNUNGSHELDEN_BASE_URL = `https://${WOHNUNGSHELDEN_HOST}`;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const headers = {
  Accept: 'application/json, text/html,application/xhtml+xml',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function splitName(profile) {
  const firstName = text(profile?.firstName);
  const lastName = text(profile?.lastName);
  if (firstName && lastName) return { firstName, lastName };

  const parts = text(profile?.name).split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : null;
}

function isStadtUndLandUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && STADT_UND_LAND_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Whether a listing belongs to Stadt und Land's Wohnungshelden workflow.
 *
 * @param {Object|null|undefined} listing
 * @returns {boolean}
 */
export function isStadtUndLandListing(listing) {
  if (!isStadtUndLandUrl(listing?.link)) return false;
  try {
    return new URL(listing.link).pathname.startsWith('/wohnungssuche/');
  } catch {
    return false;
  }
}

function listingObjectNumber(listingUrl) {
  const url = new URL(listingUrl);
  const match = url.pathname.match(/^\/wohnungssuche\/(.+?)[/]?$/);
  if (!match) return null;
  try {
    const objectNumber = decodeURIComponent(match[1]).replace(/\/$/, '');
    return objectNumber && !objectNumber.includes('?') ? objectNumber : null;
  } catch {
    return null;
  }
}

function applicationLinkFromHtml(html, listingUrl) {
  const $ = load(html);
  const candidates = [];
  $('a[href], iframe[src]').each((_, element) => {
    const value = $(element).attr(element.tagName.toLowerCase() === 'iframe' ? 'src' : 'href');
    if (value) candidates.push(value);
  });

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, listingUrl);
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== WOHNUNGSHELDEN_HOST) continue;
      const match = url.pathname.match(/^\/public\/listings\/(.+)\/application\/?$/);
      const companyId = url.searchParams.get('c');
      if (!match || !companyId || !/^[A-Za-z0-9_-]{1,100}$/.test(companyId)) continue;
      const objectNumber = decodeURIComponent(match[1]);
      if (!objectNumber || objectNumber.includes('?')) continue;
      return { applicationUrl: url.href, companyId, objectNumber };
    } catch {
      // Ignore unrelated links and report one safe error below.
    }
  }
  return null;
}

/**
 * Derive the Wohnungshelden identifiers from the live Stadt und Land page.
 *
 * @param {string} html Stadt und Land listing HTML.
 * @param {string} listingUrl The fetched Stadt und Land listing URL.
 * @returns {{applicationUrl: string, companyId: string, objectNumber: string}}
 */
export function deriveWohnungsheldenIdentifiers(html, listingUrl) {
  const listingId = listingObjectNumber(listingUrl);
  const application = applicationLinkFromHtml(html, listingUrl);
  if (!listingId || !application || application.objectNumber !== listingId) {
    throw new InquiryDeliveryError('The Stadt und Land listing has no valid Wohnungshelden form.', {
      outcome: 'failed',
      missingFields: ['applicationForm'],
      permanent: true,
    });
  }
  return application;
}

function fieldDefinitions(formConfig) {
  if (!formConfig?.formContent) return [];
  let content;
  try {
    content = typeof formConfig.formContent === 'string' ? JSON.parse(formConfig.formContent) : formConfig.formContent;
  } catch {
    throw new InquiryDeliveryError('The Wohnungshelden form configuration is invalid.', {
      outcome: 'failed',
      missingFields: ['formConfiguration'],
      permanent: true,
    });
  }

  const fields = [];
  const visit = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const field of nodes) {
      if (field && typeof field === 'object') {
        if (field.key != null && (field.templateOptions || field.props || field.validators)) fields.push(field);
        visit(field.fieldGroup);
        visit(field.fieldArray?.fieldGroup);
      }
    }
  };
  visit(content);
  return fields;
}

function modelValue(key, profile, dynamicValues) {
  if (Object.prototype.hasOwnProperty.call(dynamicValues, key)) return dynamicValues[key];
  if (Object.prototype.hasOwnProperty.call(profile ?? {}, key)) return profile[key];

  const aliases = {
    stadt_und_land_anzahl_einziehende_personen: ['numberOfPersons'],
    stadt_und_land_anzahl_kinder: ['numberOfChildren'],
    stadt_und_land_ab_wann_kann_wohnung_angemietet_werden: ['moveInDate'],
    stadt_und_land_wie_aufmerksam_geworden: ['howFoundUs'],
    stadt_und_land_wie_aufmerksam_geworden_sonstiges: ['howFoundUsOther'],
    $$_wbs_available_$$: ['wbsAvailable'],
    stadt_und_land_gueltigkeit_wbs: ['wbsValidUntil'],
    $$_wbs_max_number_rooms_$$: ['wbsMaxRooms'],
  };
  const alias = aliases[key]?.find((candidate) => Object.prototype.hasOwnProperty.call(profile ?? {}, candidate));
  return alias === undefined ? undefined : profile[alias];
}

function conditionalFieldVisible(field, profile, dynamicValues) {
  const expression = text(field.hideExpression ?? field.expressions?.hide);
  if (!expression) return true;

  const match = expression.match(/^model\.([A-Za-z0-9_$%]+)\s*(===|!==|==|!=)\s*(true|false|'[^']*'|"[^"]*")$/);
  if (!match) return true;
  const actual = modelValue(match[1], profile, dynamicValues);
  const expectedToken = match[3];
  const expected = expectedToken === 'true' ? true : expectedToken === 'false' ? false : expectedToken.slice(1, -1);
  const equal = actual === expected;
  return match[2] === '===' || match[2] === '==' ? !equal : equal;
}

function isRequired(field) {
  const required = field.templateOptions?.required ?? field.props?.required;
  const validators = field.validators?.validation;
  return required === true || (Array.isArray(validators) && validators.includes('requiredTrue'));
}

function requiresTrue(field) {
  return Array.isArray(field.validators?.validation) && field.validators.validation.includes('requiredTrue');
}

function requiredBaseFields(formConfig, values) {
  const missing = [];
  const fieldConfigs = formConfig?.publicApplicationCreationConfig?.fieldConfigs ?? [];
  for (const fieldConfig of fieldConfigs) {
    if (fieldConfig?.required !== true) continue;
    switch (fieldConfig.fieldType) {
      case 'SALUTATION':
        if (!values.salutation) missing.push('salutation');
        break;
      case 'NAME':
        if (!values.firstName || !values.lastName) missing.push('name');
        break;
      case 'MEMBERSHIP_ID':
        if (!values.membershipId) missing.push('membershipId');
        break;
      case 'PHONE_NUMBER':
        if (!values.phoneNumber) missing.push('phoneNumber');
        break;
      case 'ADDRESS':
        for (const key of ['street', 'houseNumber', 'zipCode', 'city']) {
          if (!values[key]) missing.push(key === 'zipCode' ? 'postcode' : key);
        }
        break;
      case 'APPLICANT_MESSAGE':
        if (!values.applicantMessage) missing.push('message');
        break;
      default:
        missing.push(String(fieldConfig.fieldType || 'baseField'));
    }
  }
  if (!EMAIL_PATTERN.test(values.email)) missing.push('signedInEmail');
  return missing;
}

function warmRentOf(listing) {
  const match = text(listing?.description).match(/Gesamtmiete:\s*([0-9.,]+)\s*€/i);
  return extractNumber(match?.[1]);
}

function dynamicValuesOf(profile, listing) {
  const netIncome = extractNumber(profile?.netIncome);
  const warmRent = warmRentOf(listing);
  const withinBudget =
    netIncome != null && netIncome > 0 && warmRent != null ? warmRent <= netIncome * 0.35 : undefined;
  return {
    ...(profile?.wohnungsheldenFormData ?? {}),
    ...(profile?.stadtUndLandFormData ?? {}),
    ...(profile?.wohnungsheldenFields ?? {}),
    ...(profile?.stadtUndLandFields ?? {}),
    'stadt_und_land_monatliche_warmmiete_hoechstens_35%_monatliches_netto_haushaltseinkommen': withinBudget,
    stadt_und_land_wie_aufmerksam_geworden: 'Inberlinwohnen.de',
    stadt_und_land_bestaetigung_datenschutzhinweis: true,
    $$_wbs_available_$$: profile?.wbsAvailable,
  };
}

/**
 * Build the JSON body used by the public Wohnungshelden application endpoint.
 *
 * Dynamic Formly values may be supplied by their exact provider keys through
 * `stadtUndLandFormData` or `wohnungsheldenFormData`; known current Stadt und Land keys also map
 * to the existing Fredy profile fields. The authenticated account email is always authoritative.
 *
 * @param {Object} profile
 * @param {string} accountEmail Authenticated Fredy login email.
 * @param {string} message
 * @param {Object} formConfig Live Wohnungshelden application-form response.
 * @returns {{body: Object|null, missingFields: string[]}}
 */
export function buildWohnungsheldenApplication(profile, accountEmail, message, formConfig, listing) {
  const name = splitName(profile);
  const dynamicValues = dynamicValuesOf(profile, listing);
  const values = {
    applicantMessage: text(message),
    email: text(accountEmail),
    firstName: name?.firstName ?? null,
    lastName: name?.lastName ?? null,
    membershipId: text(profile?.membershipId) || null,
    phoneNumber: text(profile?.phoneNumber) || null,
    salutation: text(profile?.salutation) || null,
    street: text(profile?.street) || null,
    houseNumber: text(profile?.houseNumber) || null,
    zipCode: text(profile?.postcode) || null,
    city: text(profile?.city) || null,
    additionalAddressInformation: text(profile?.additionalAddressInformation) || null,
  };
  const missingFields = requiredBaseFields(formConfig, values);
  const formData = {};
  const definitions = fieldDefinitions(formConfig);
  const orderedKeys = Array.isArray(formConfig?.keyOrder)
    ? formConfig.keyOrder
    : definitions.map((field) => String(field.key));

  for (const key of orderedKeys) {
    const field = definitions.find((candidate) => String(candidate.key) === String(key));
    if (field && !conditionalFieldVisible(field, profile, dynamicValues)) continue;
    const value = modelValue(String(key), profile, dynamicValues);
    if (value !== undefined) formData[key] = value;
  }

  for (const field of definitions) {
    const key = String(field.key);
    if (!conditionalFieldVisible(field, profile, dynamicValues)) continue;
    const value = modelValue(key, profile, dynamicValues);
    if (value !== undefined && !Object.prototype.hasOwnProperty.call(formData, key)) formData[key] = value;
    if (!isRequired(field)) continue;
    const present = value !== undefined && value !== null && value !== '';
    if (!present || (requiresTrue(field) && value !== true)) missingFields.push(key);
  }

  if (missingFields.length > 0) return { body: null, missingFields: unique(missingFields) };
  return {
    body: {
      publicApplicationCreationTO: values,
      saveFormDataTO: { formData, files: [] },
      isApplicationSourceCrm: false,
    },
    missingFields: [],
  };
}

function safeProviderError(value) {
  if (value == null) return null;
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gi, '[redacted-email]')
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, '[redacted-number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function providerErrorText(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') return safeProviderError(payload);
  const candidate = payload?.message ?? payload?.error?.message ?? payload?.error ?? payload?.code;
  return typeof candidate === 'string' ? safeProviderError(candidate) : null;
}

async function responsePayload(response) {
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
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

function requestTimeout(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;
}

function providerResponseError(message, response, payload, outcome = 'failed') {
  const providerError = providerErrorText(payload);
  return new InquiryDeliveryError(
    providerError ? `${message} (HTTP ${response.status}): ${providerError}.` : `${message} (HTTP ${response.status}).`,
    { outcome, status: response.status, providerError },
  );
}

/**
 * Submit one Stadt und Land inquiry through the browser-free Wohnungshelden API.
 *
 * The listing page is fetched first because the company id is supplied by its embedded application
 * link. The fresh form response controls requiredness. No POST is made when reCAPTCHA or a
 * mandatory upload is present, and the single POST is never retried. Only a 2xx response from the
 * exact create-application endpoint is considered confirmed; 4xx is rejection and all other
 * uncertain post-send outcomes are unknown.
 *
 * @param {{listing: Object, profile: Object, accountEmail: string, message?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendWohnungsheldenInquiry({
  listing,
  profile,
  accountEmail,
  message = '',
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  if (!isStadtUndLandListing(listing)) {
    throw new InquiryDeliveryError('This listing is not a supported Stadt und Land application.', {
      outcome: 'failed',
      missingFields: ['supportedPartner'],
      permanent: true,
    });
  }

  const listingUrl = new URL(listing.link).href;
  const requestTimeoutMs = requestTimeout(timeoutMs);
  let detailHtml;
  let detailResponse;
  try {
    detailResponse = await fetchWithTimeout(fetchImpl, listingUrl, { headers }, requestTimeoutMs);
    if (!detailResponse.ok) {
      let payload = null;
      try {
        payload = await responsePayload(detailResponse);
      } catch {
        // Keep the error safe and generic when the provider body cannot be read.
      }
      throw providerResponseError('Could not load the Stadt und Land listing', detailResponse, payload);
    }
    detailHtml = await detailResponse.text();
  } catch (error) {
    if (error instanceof InquiryDeliveryError) throw error;
    throw new InquiryDeliveryError('Could not load the Stadt und Land listing.', { outcome: 'failed', cause: error });
  }

  const { companyId, objectNumber } = deriveWohnungsheldenIdentifiers(detailHtml, listingUrl);
  const formUrl = `${WOHNUNGSHELDEN_BASE_URL}/api/public/application-form/${encodeURIComponent(companyId)}/${encodeURIComponent(objectNumber)}`;
  let formResponse;
  let formConfig;
  try {
    formResponse = await fetchWithTimeout(fetchImpl, formUrl, { headers }, requestTimeoutMs);
    let payload = null;
    try {
      payload = await responsePayload(formResponse);
    } catch {
      // The generic requirements failure below avoids exposing a raw provider response.
    }
    if (!formResponse.ok)
      throw providerResponseError('Could not read Wohnungshelden application requirements', formResponse, payload);
    if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new InquiryDeliveryError('Could not read Wohnungshelden application requirements.', {
        outcome: 'failed',
        status: formResponse.status,
      });
    }
    formConfig = payload;
  } catch (error) {
    if (error instanceof InquiryDeliveryError) throw error;
    throw new InquiryDeliveryError('Could not read Wohnungshelden application requirements.', {
      outcome: 'failed',
      cause: error,
    });
  }

  if (formConfig.useRecaptcha === true) {
    throw new InquiryDeliveryError('Wohnungshelden requires reCAPTCHA; automatic applications are disabled.', {
      outcome: 'failed',
      missingFields: ['captcha'],
      permanent: true,
    });
  }
  if (
    Array.isArray(formConfig.formFileConfigs) &&
    formConfig.formFileConfigs.some((config) => config?.mandatory === true || config?.required === true)
  ) {
    throw new InquiryDeliveryError('Wohnungshelden requires a document upload; automatic applications are disabled.', {
      outcome: 'failed',
      missingFields: ['documentUpload'],
      permanent: true,
    });
  }

  const { body, missingFields } = buildWohnungsheldenApplication(profile, accountEmail, message, formConfig, listing);
  if (missingFields.length > 0) {
    throw new InquiryDeliveryError('Required Wohnungshelden inquiry fields are missing.', {
      outcome: 'failed',
      missingFields,
      permanent: true,
    });
  }

  const sendUrl = `${WOHNUNGSHELDEN_BASE_URL}/api/applicationFormEndpoint/3.0/form/create-application/${encodeURIComponent(
    companyId,
  )}/${encodeURIComponent(objectNumber)}`;
  let sendResponse;
  try {
    sendResponse = await fetchWithTimeout(
      fetchImpl,
      sendUrl,
      {
        method: 'POST',
        redirect: 'manual',
        headers: { ...headers, 'Content-Type': 'application/json', Referer: listingUrl },
        body: JSON.stringify(body),
      },
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('The Wohnungshelden inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }

  if (sendResponse.status >= 500) {
    throw new InquiryDeliveryError('The Wohnungshelden inquiry outcome is unknown.', {
      outcome: 'unknown',
      status: sendResponse.status,
    });
  }
  if (sendResponse.status >= 400) {
    let payload = null;
    try {
      payload = await responsePayload(sendResponse);
    } catch {
      // Do not expose an unreadable provider body.
    }
    throw providerResponseError('Wohnungshelden rejected the inquiry', sendResponse, payload, 'failed');
  }
  if (sendResponse.status < 200 || sendResponse.status >= 300) {
    throw new InquiryDeliveryError('The Wohnungshelden inquiry outcome is unknown.', {
      outcome: 'unknown',
      status: sendResponse.status,
    });
  }

  return { requestId: `stadtundland:${objectNumber}`, sentAt: Date.now() };
}
