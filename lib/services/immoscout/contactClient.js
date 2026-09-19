/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { InquiryDeliveryError } from '../inquiries/errors.js';

const MOBILE_API_BASE = 'https://api.mobile.immobilienscout24.de';
const USER_AGENT = 'ImmoScout24_1565_35_._';
const SUPPORTED_SCREENS = [
  'recommendations',
  'saveSearch',
  'registration',
  'valuation',
  'financing',
  'tenantNetwork',
  'plus',
];

const REQUIREMENTS = {
  moveInDateField: ['moveInDate', 'moveInDate'],
  petsInHouseholdField: ['petsInHousehold', 'petsInHousehold'],
  numberOfPersonsField: ['numberOfPersons', 'numberOfPersons'],
  employmentRelationshipField: ['employmentRelationship', 'employmentRelationship'],
  incomeField: ['income', 'income'],
  firstnameField: ['firstname', 'name'],
  lastnameField: ['lastname', 'name'],
  phoneNumberField: ['phoneNumber', 'phoneNumber'],
  emailAddressField: ['emailAddress', 'signedInEmail'],
  addressField: ['address', 'address'],
  applicationPackageCompletedField: ['applicationPackageCompleted', 'applicationPackageCompleted'],
  salutationField: ['salutation', 'salutation'],
  messageField: ['message', 'message'],
};

const REAL_ESTATE_TYPES = {
  apartmentrent: 'ApartmentRent',
  apartmentbuy: 'ApartmentBuy',
  houserent: 'HouseRent',
  housebuy: 'HouseBuy',
  flatshareroom: 'FlatShareRoom',
  shorttermaccommodation: 'ShortTermAccommodation',
};

const headers = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
  'Accept-Language': 'de-DE',
  'Content-Type': 'application/json',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const email = (value) => {
  const normalized = text(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};

function splitName(profile) {
  const explicitFirst = text(profile?.firstName);
  const explicitLast = text(profile?.lastName);
  if (explicitFirst && explicitLast) return { firstname: explicitFirst, lastname: explicitLast };

  const parts = text(profile?.name).split(/\s+/).filter(Boolean);
  return parts.length >= 2
    ? { firstname: parts[0], lastname: parts.slice(1).join(' ') }
    : { firstname: explicitFirst, lastname: explicitLast };
}

function contactDataOf(detail) {
  const contact = detail?.contact ?? detail?.sections?.find((section) => section?.type === 'CONTACT');
  if (contact == null || contact.mailButtonState !== 'active') {
    throw new InquiryDeliveryError('This listing does not accept messages through ImmoScout.');
  }
  if (String(contact.premiumProfileRequiredForContacting).toLowerCase() === 'true') {
    throw new InquiryDeliveryError('This listing requires an ImmoScout premium profile.');
  }
  return { contact, data: contact.contactData ?? {} };
}

function addressOf(profile) {
  const address = {
    street: text(profile?.street),
    houseNumber: text(profile?.houseNumber),
    postcode: text(profile?.postcode),
    city: text(profile?.city),
  };
  return Object.values(address).every(Boolean) ? address : null;
}

/**
 * Build the mobile API contact form and report mandatory fields the profile cannot satisfy.
 *
 * Optional fields are sent only when the user supplied them. No lifestyle or financial fact is
 * invented to make a provider form pass.
 *
 * @param {Object} profile
 * @param {string} message
 * @param {Record<string, string>} formFieldConfig
 * @param {{accountEmail?: string}} [identity]
 * @returns {{form: Object, missingFields: string[]}}
 */
export function buildContactForm(profile, message, formFieldConfig = {}, { accountEmail } = {}) {
  const name = splitName(profile);
  const address = addressOf(profile);
  const values = {
    ...name,
    address,
    emailAddress: email(accountEmail),
    phoneNumber: text(profile?.phoneNumber),
    salutation: text(profile?.salutation),
    numberOfPersons: text(profile?.numberOfPersons),
    employmentRelationship: text(profile?.employmentRelationship),
    income: text(profile?.income),
    moveInDate: text(profile?.moveInDate),
    petsInHousehold: text(profile?.petsInHousehold),
    applicationPackageCompleted:
      typeof profile?.applicationPackageCompleted === 'boolean' ? profile.applicationPackageCompleted : null,
    message: text(message),
  };

  const missingFields = [];
  for (const [configKey, [bodyKey, profileKey]] of Object.entries(REQUIREMENTS)) {
    if (formFieldConfig?.[configKey] !== 'MANDATORY') continue;
    const value = values[bodyKey];
    if (value == null || value === '') missingFields.push(profileKey);
  }
  if (!values.emailAddress) missingFields.push('signedInEmail');
  if (profile?.immoscoutPrivacyAccepted !== true) missingFields.push('immoscoutPrivacyAccepted');

  const form = { privacyPolicyAccepted: true, sendProfile: false };
  for (const [key, value] of Object.entries(values)) {
    if (value != null && value !== '') form[key] = value;
  }
  if (values.petsInHousehold) {
    form.hasPets = !/^(keine|keins|nein|none|no)$/i.test(values.petsInHousehold);
  }

  return { form, missingFields: [...new Set(missingFields)] };
}

function exposeIdOf(listing) {
  const match = String(listing?.link ?? '').match(/\/expose\/(\d+)/);
  if (!match) throw new InquiryDeliveryError('The listing does not contain an ImmoScout exposé id.');
  return match[1];
}

async function responseJson(response) {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function postContact(fetchImpl, url, body, doNotSend, timeoutMs) {
  return fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, doNotSend }),
    },
    timeoutMs,
  );
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

/**
 * Validate and submit one ImmoScout inquiry. Validation is always performed first with
 * `doNotSend=true`. The real request is attempted exactly once; a timeout, network failure, 5xx,
 * or a success response without a request id is classified as unknown and must never be retried
 * automatically.
 *
 * @param {{listing: Object, profile: Object, accountEmail: string, message: string, fetchImpl?: typeof fetch, timeoutMs?: number}} params
 * @returns {Promise<{requestId: string, sentAt: number}>}
 */
export async function sendImmoscoutInquiry({
  listing,
  profile,
  accountEmail,
  message,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const exposeId = exposeIdOf(listing);
  const requestTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 30_000;
  let detailResponse;
  try {
    detailResponse = await fetchWithTimeout(
      fetchImpl,
      `${MOBILE_API_BASE}/expose/${exposeId}`,
      { headers },
      requestTimeoutMs,
    );
  } catch (error) {
    throw new InquiryDeliveryError('Could not read the ImmoScout contact requirements.', { cause: error });
  }
  if (!detailResponse.ok) {
    throw new InquiryDeliveryError('Could not read the ImmoScout contact requirements.', {
      status: detailResponse.status,
    });
  }

  const { data } = contactDataOf(await detailResponse.json());
  const { form, missingFields } = buildContactForm(profile, message, data.formFieldConfig, { accountEmail });
  if (missingFields.length > 0) {
    throw new InquiryDeliveryError(`Applicant profile is missing: ${missingFields.join(', ')}.`, { missingFields });
  }

  const realEstateType = REAL_ESTATE_TYPES[String(data.realEstateType ?? '').toLowerCase()];
  if (!realEstateType) throw new InquiryDeliveryError('This ImmoScout real-estate type is not supported for sending.');

  const requestBody = {
    'expose.contactForm': form,
    realEstateType,
    supportedScreens: SUPPORTED_SCREENS,
    requestCount: 1,
    isTenantNetworkListing: data.isTenantNetwork === true,
  };
  const url = `${MOBILE_API_BASE}/expose/${exposeId}/contact?referrer=resultlist`;

  let validationResponse;
  try {
    validationResponse = await postContact(fetchImpl, url, requestBody, true, requestTimeoutMs);
  } catch (error) {
    throw new InquiryDeliveryError('ImmoScout could not validate the inquiry.', { cause: error });
  }
  if (!validationResponse.ok) {
    throw new InquiryDeliveryError('ImmoScout rejected the inquiry during validation.', {
      status: validationResponse.status,
    });
  }

  let sendResponse;
  try {
    sendResponse = await postContact(fetchImpl, url, requestBody, false, requestTimeoutMs);
  } catch (error) {
    throw new InquiryDeliveryError('The ImmoScout inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }
  let result;
  try {
    result = await responseJson(sendResponse);
  } catch (error) {
    throw new InquiryDeliveryError('The ImmoScout inquiry outcome is unknown.', {
      outcome: 'unknown',
      cause: error,
    });
  }
  if (!sendResponse.ok) {
    throw new InquiryDeliveryError(
      sendResponse.status >= 500 ? 'The ImmoScout inquiry outcome is unknown.' : 'ImmoScout rejected the inquiry.',
      { outcome: sendResponse.status >= 500 ? 'unknown' : 'failed', status: sendResponse.status },
    );
  }
  if (typeof result.id !== 'string' || result.id.length === 0) {
    throw new InquiryDeliveryError('The ImmoScout inquiry outcome is unknown.', { outcome: 'unknown' });
  }
  return { requestId: result.id, sentAt: Date.now() };
}
