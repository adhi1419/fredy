/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { isInquiryProfileReady, sanitizeInquiryProfile } from '../../../lib/services/inquiries/profile.js';

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
