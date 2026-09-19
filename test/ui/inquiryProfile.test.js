/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  inquiryProviderRequiresMessage,
  isInquiryContactProfileReady,
  isInquiryProviderSupported,
} from '../../ui/src/services/inquiries/profile.js';

const complete = {
  name: 'Alice Example',
  street: 'Main Street',
  houseNumber: '1',
  postcode: '10115',
  city: 'Berlin',
  immoscoutPrivacyAccepted: true,
};

describe('isInquiryContactProfileReady', () => {
  it('accepts the verified contact fields plus consent', () => {
    expect(isInquiryContactProfileReady(complete)).toBe(true);
  });

  it.each(['name', 'street', 'houseNumber', 'postcode', 'city'])('rejects a missing %s', (field) => {
    expect(isInquiryContactProfileReady({ ...complete, [field]: '' })).toBe(false);
  });

  it('requires a first and last name', () => {
    expect(isInquiryContactProfileReady({ ...complete, name: 'Alice' })).toBe(false);
  });

  it('requires explicit provider-contact consent', () => {
    expect(isInquiryContactProfileReady({ ...complete, immoscoutPrivacyAccepted: false })).toBe(false);
  });

  it('checks Deutsche Wohnen phone, income selections, and consent separately', () => {
    const deutscheWohnenProfile = {
      name: 'Alice Example',
      phoneNumber: '+49 30 123456',
      deutscheWohnenIncomeType: '1',
      deutscheWohnenMonthlyNetIncome: 'M_3',
      deutscheWohnenPrivacyAccepted: true,
    };
    expect(isInquiryContactProfileReady(deutscheWohnenProfile, 'deutscheWohnen')).toBe(true);
    expect(
      isInquiryContactProfileReady(
        { ...deutscheWohnenProfile, deutscheWohnenPrivacyAccepted: false },
        'deutscheWohnen',
      ),
    ).toBe(false);
  });

  it('supports HOWOGE partner links without requiring a generated message', () => {
    const howogeListing = {
      link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html',
    };
    expect(isInquiryProviderSupported('immoscout')).toBe(true);
    expect(isInquiryProviderSupported('deutscheWohnen')).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen')).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', howogeListing)).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', { link: 'https://www.degewo.de/test' })).toBe(false);
    expect(inquiryProviderRequiresMessage('inberlinwohnen', howogeListing)).toBe(false);
    expect(
      isInquiryContactProfileReady({ name: 'Alice Example', howogeApplicationAccepted: true }, 'inberlinwohnen'),
    ).toBe(true);
  });
});
