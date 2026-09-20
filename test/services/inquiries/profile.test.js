/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  isCommonInquiryProfileReady,
  isInquiryProfileReady,
  sanitizeInquiryProfile,
} from '../../../lib/services/inquiries/profile.js';

describe('sanitizeInquiryProfile', () => {
  it('removes an email override while preserving applicant facts', () => {
    expect(sanitizeInquiryProfile({ name: 'Alice Example', email: 'override@example.net', city: 'Berlin' })).toEqual({
      name: 'Alice Example',
      city: 'Berlin',
    });
  });
});

describe('isInquiryProfileReady', () => {
  it('requires provider-specific consent and fields plus the authenticated email', () => {
    expect(
      isInquiryProfileReady(
        {
          name: 'Alice Example',
          phoneNumber: '+49 30 123456',
          deutscheWohnenIncomeType: '1',
          deutscheWohnenMonthlyNetIncome: 'M_3',
          deutscheWohnenPrivacyAccepted: true,
        },
        'alice@example.com',
        'deutscheWohnen',
      ),
    ).toBe(true);
    expect(
      isInquiryProfileReady(
        { name: 'Alice Example', howogeApplicationAccepted: true },
        'alice@example.com',
        'inberlinwohnen',
      ),
    ).toBe(true);
    expect(
      isInquiryProfileReady(
        { name: 'Alice Example', howogeApplicationAccepted: true },
        'not-an-email',
        'inberlinwohnen',
      ),
    ).toBe(false);
  });
});

describe('isCommonInquiryProfileReady', () => {
  const complete = {
    name: 'Alice Example',
    street: 'Main Street',
    houseNumber: '1',
    postcode: '10115',
    city: 'Berlin',
    employmentType: 'explicitly supplied',
    deutscheWohnenPrivacyAccepted: false,
  };

  it('accepts explicit common identity and address facts without provider consent', () => {
    expect(isCommonInquiryProfileReady(complete)).toBe(true);
  });

  it.each(['name', 'street', 'houseNumber', 'postcode', 'city'])('rejects missing %s', (field) => {
    expect(isCommonInquiryProfileReady({ ...complete, [field]: '' })).toBe(false);
  });

  it('requires a full name rather than inferring a surname', () => {
    expect(isCommonInquiryProfileReady({ ...complete, name: 'Alice' })).toBe(false);
  });
});
