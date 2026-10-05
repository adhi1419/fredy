/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

const present = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const INQUIRY_PROVIDERS = new Set(['deutscheWohnen', 'immoscout', 'inberlinwohnen', 'kleinanzeigen']);
const INBERLIN_HOSTS = new Set(['howoge.de', 'wbm.de', 'stadtundland.de']);
const DEUTSCHE_WOHNEN_INCOME_TYPES = new Set(['1', '2', '3', '4']);
const DEUTSCHE_WOHNEN_INCOME_AMOUNTS = new Set(['M_1', 'M_2', 'M_3', 'M_A']);
const WBM_INCOME_LIMITS = new Set(['100', '140', '160', '180', '220']);
const nonNegativeInteger = (value: unknown): boolean =>
  value !== '' && value != null && Number.isInteger(Number(value)) && Number(value) >= 0;
const positiveInteger = (value: unknown): boolean => nonNegativeInteger(value) && Number(value) > 0;

/** The contact profile as the inquiry controls read it. Every field is optional and untrusted. */
export interface InquiryContactProfile {
  name?: unknown;
  netIncome?: unknown;
  street?: unknown;
  houseNumber?: unknown;
  postcode?: unknown;
  city?: unknown;
  phoneNumber?: unknown;
  deutscheWohnenIncomeType?: unknown;
  deutscheWohnenMonthlyNetIncome?: unknown;
  salutation?: unknown;
  numberOfPersons?: unknown;
  numberOfChildren?: unknown;
  wbsAvailable?: unknown;
  wbsValidUntil?: unknown;
  wbsMaxRooms?: unknown;
  wbsIncomeLimit?: unknown;
  wbsSpecialNeed?: unknown;
  moveInDate?: unknown;
}

/** A listing, only the fields these checks read. */
interface InquiryListing {
  link?: unknown;
}

function listingHost(listing: unknown): string | null {
  try {
    return new URL(String((listing as InquiryListing)?.link)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isInquiryProviderSupported(providerId: string | undefined, listing?: unknown): boolean {
  if (providerId == null || !INQUIRY_PROVIDERS.has(providerId)) return false;
  if (providerId !== 'inberlinwohnen' || listing == null) return true;
  const host = listingHost(listing);
  return host != null && INBERLIN_HOSTS.has(host);
}

export function inquiryProviderRequiresMessage(providerId: string | undefined, listing?: unknown): boolean {
  return !(providerId === 'inberlinwohnen' && isInquiryProviderSupported(providerId, listing));
}

const BLOCKED_INQUIRY_SEND_STATUSES = new Set(['sending', 'sent', 'unknown']);

export interface InquirySendEligibility {
  providerSupported: boolean;
  profileReady: boolean;
  messageReady: boolean;
  statusAllowsSend: boolean;
  canRetry: boolean;
  canSend: boolean;
}

/**
 * Calculate the one send decision shared by every listing-detail inquiry control.
 *
 * A missing status is the initial state. Once a listing has a persisted status, only an explicit
 * `failed` outcome may be sent again; `sending`, `sent`, `unknown`, and any other persisted value
 * are deliberately blocked because the provider may already have received the request.
 */
export function getInquirySendEligibility({
  providerId,
  listing,
  profile,
  message,
  status,
}: {
  providerId?: string;
  listing?: unknown;
  profile?: unknown;
  message?: unknown;
  status?: unknown;
} = {}): InquirySendEligibility {
  const persistedStatus = status == null ? '' : String(status).trim();
  const providerSupported = isInquiryProviderSupported(providerId, listing);
  const profileReady = isInquiryContactProfileReady(profile, providerId, listing);
  const messageReady = !inquiryProviderRequiresMessage(providerId, listing) || present(message);
  const statusAllowsSend = persistedStatus === '' || persistedStatus === 'failed';
  const canRetry = persistedStatus === 'failed';

  return {
    providerSupported,
    profileReady,
    messageReady,
    statusAllowsSend: statusAllowsSend && !BLOCKED_INQUIRY_SEND_STATUSES.has(persistedStatus),
    canRetry,
    canSend: providerSupported && profileReady && messageReady && statusAllowsSend,
  };
}

function wbsProfileReady(profile: InquiryContactProfile | undefined, requireIncomeLimit = false): boolean {
  if (typeof profile?.wbsAvailable !== 'boolean') return false;
  if (!profile.wbsAvailable) return true;
  return (
    present(profile.wbsValidUntil) &&
    positiveInteger(profile.wbsMaxRooms) &&
    (!requireIncomeLimit || WBM_INCOME_LIMITS.has(String(profile.wbsIncomeLimit))) &&
    (!requireIncomeLimit || typeof profile.wbsSpecialNeed === 'boolean')
  );
}

function inBerlinProfileReady(profile: InquiryContactProfile | undefined, listing?: unknown): boolean {
  const host = listing == null ? null : listingHost(listing);
  const howogeReady = true;
  const wbmReady = present(profile?.salutation) && wbsProfileReady(profile, true);
  const stadtReady =
    present(profile?.salutation) &&
    positiveInteger(profile?.numberOfPersons) &&
    nonNegativeInteger(profile?.numberOfChildren) &&
    present(profile?.moveInDate) &&
    present(profile?.netIncome) &&
    wbsProfileReady(profile);

  if (host == null) return howogeReady || wbmReady || stadtReady;
  if (host === 'howoge.de') return howogeReady;
  if (host === 'wbm.de') return wbmReady;
  if (host === 'stadtundland.de') return stadtReady;
  return false;
}

/**
 * Whether the profile can attempt the selected provider's contact form.
 *
 * The signed-in email is deliberately absent: it is server-owned identity and cannot be supplied
 * or overridden by this profile. Provider validation remains authoritative.
 */
export function isInquiryContactProfileReady(profile: unknown, providerId = 'immoscout', listing?: unknown): boolean {
  const candidate = (profile ?? undefined) as InquiryContactProfile | undefined;
  const name = candidate?.name;
  const hasName = present(name) && name.trim().split(/\s+/).length >= 2;
  if (!hasName) return false;

  if (providerId === 'immoscout') {
    return (
      present(candidate?.street) &&
      present(candidate?.houseNumber) &&
      present(candidate?.postcode) &&
      present(candidate?.city)
    );
  }

  if (providerId === 'deutscheWohnen') {
    return (
      present(candidate?.phoneNumber) &&
      DEUTSCHE_WOHNEN_INCOME_TYPES.has(candidate?.deutscheWohnenIncomeType as string) &&
      DEUTSCHE_WOHNEN_INCOME_AMOUNTS.has(candidate?.deutscheWohnenMonthlyNetIncome as string)
    );
  }

  if (providerId === 'kleinanzeigen') return true;
  if (providerId === 'inberlinwohnen') return inBerlinProfileReady(candidate, listing);
  return false;
}
