/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { resolveAutomaticInquiryPolicy } from '../../../lib/services/providers/applicationPolicyExecution.js';

const providerCapability = (eligibility = 'provider', automatic = true) => ({ automatic, eligibility });
const listing = (link = 'https://www.immobilienscout24.de/expose/1') => ({ link });

const resolve = (
  source,
  { legacyAutoSendInquiry = false, providerId = source?.id, capability = providerCapability(), item = listing() } = {},
) =>
  resolveAutomaticInquiryPolicy({
    source,
    legacyAutoSendInquiry,
    providerId,
    capability,
    listing: item,
  });

describe('automatic inquiry policy execution resolver', () => {
  it.each([
    [{ automatic: 'enabled' }, false, true],
    [{ automatic: 'disabled' }, true, false],
  ])('gives explicit source policy precedence over legacy %s', (applicationPolicy, legacy, expected) => {
    expect(resolve({ id: 'immoscout', applicationPolicy }, { legacyAutoSendInquiry: legacy })).toBe(expected);
  });

  it('uses the legacy flag only when the exact source policy is absent', () => {
    expect(resolve({ id: 'immoscout' }, { legacyAutoSendInquiry: true })).toBe(true);
    expect(resolve({ id: 'immoscout', applicationPolicy: {} }, { legacyAutoSendInquiry: true })).toBe(false);
  });

  it('keeps independent policies for multiple URLs of the same provider', () => {
    const disabled = {
      id: 'immoscout',
      url: 'https://example.com/search/disabled',
      applicationPolicy: { automatic: 'disabled' },
    };
    const enabled = {
      id: 'immoscout',
      url: 'https://example.com/search/enabled',
      applicationPolicy: { automatic: 'enabled' },
    };

    expect(resolve(disabled, { legacyAutoSendInquiry: true })).toBe(false);
    expect(resolve(enabled, { legacyAutoSendInquiry: false })).toBe(true);
  });

  it('requires the exact source to belong to the provider being executed', () => {
    expect(
      resolve({ id: 'deutscheWohnen', applicationPolicy: { automatic: 'enabled' } }, { providerId: 'immoscout' }),
    ).toBe(false);
  });

  it('requires an automatic capability with recognized eligibility', () => {
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } };
    expect(resolve(source, { capability: providerCapability('provider', false) })).toBe(false);
    expect(resolve(source, { capability: { automatic: true, eligibility: 'unknown' } })).toBe(false);
  });

  it('requires the existing sender predicate for listing-scoped capability', () => {
    const source = { id: 'inberlinwohnen', applicationPolicy: { automatic: 'enabled' } };
    const capability = providerCapability('listing');

    expect(
      resolve(source, {
        capability,
        item: listing('https://www.howoge.de/immobiliensuche/detail/1'),
      }),
    ).toBe(true);
    expect(
      resolve(source, {
        capability,
        item: listing('https://www.degewo.de/immobilien/1'),
      }),
    ).toBe(false);
  });

  it('defaults conservatively for unknown, malformed, or incomplete input', () => {
    expect(resolveAutomaticInquiryPolicy()).toBe(false);
    expect(resolve({ id: 'unknown', applicationPolicy: { automatic: 'enabled' } }, { capability: null })).toBe(false);
    expect(resolve({ id: 'immoscout', applicationPolicy: { automatic: 'sometimes' } })).toBe(false);
    expect(
      resolve({ id: 'immoscout', applicationPolicy: { automatic: 'enabled' } }, { providerId: 'missing-from-source' }),
    ).toBe(false);
  });
});
