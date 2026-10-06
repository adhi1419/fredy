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
  it('requires provider-specific facts plus the authenticated email', () => {
    expect(
      isInquiryProfileReady(
        {
          name: 'Alice Example',
          phoneNumber: '+49 30 123456',
          deutscheWohnenIncomeType: '1',
          deutscheWohnenMonthlyNetIncome: 'M_3',
        },
        'alice@example.com',
        'deutscheWohnen',
      ),
    ).toBe(true);
    expect(isInquiryProfileReady({ name: 'Alice Example' }, 'alice@example.com', 'kleinanzeigen')).toBe(true);
    expect(isInquiryProfileReady({ name: 'Alice Example' }, 'not-an-email', 'kleinanzeigen')).toBe(false);

    const howogeListing = { link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1.html' };
    expect(isInquiryProfileReady({ name: 'Alice Example' }, 'alice@example.com', 'inberlinwohnen', howogeListing)).toBe(
      true,
    );

    const wbmListing = { link: 'https://www.wbm.de/wohnungen-berlin/angebote/details/example/' };
    const wbmProfile = {
      name: 'Alice Example',
      salutation: 'Frau',
      wbsAvailable: false,
    };
    expect(isInquiryProfileReady(wbmProfile, 'alice@example.com', 'inberlinwohnen', wbmListing)).toBe(true);
    expect(isInquiryProfileReady(wbmProfile, 'alice@example.com', 'wbm')).toBe(true);
    expect(
      isInquiryProfileReady({ ...wbmProfile, salutation: '' }, 'alice@example.com', 'inberlinwohnen', wbmListing),
    ).toBe(false);
    expect(isInquiryProfileReady({ ...wbmProfile, salutation: '' }, 'alice@example.com', 'wbm')).toBe(false);

    const stadtListing = { link: 'https://stadtundland.de/wohnungssuche/1001%2F7318%2F00031' };
    const stadtProfile = {
      name: 'Alice Example',
      salutation: 'Frau',
      numberOfPersons: '2',
      numberOfChildren: '0',
      moveInDate: '01.11.2026',
      netIncome: '3500 €',
      wbsAvailable: false,
    };
    expect(isInquiryProfileReady(stadtProfile, 'alice@example.com', 'inberlinwohnen', stadtListing)).toBe(true);
    expect(isInquiryProfileReady(stadtProfile, 'not-an-email', 'inberlinwohnen', stadtListing)).toBe(false);
    expect(isInquiryProfileReady(stadtProfile, 'alice@example.com', 'inberlinwohnen')).toBe(true);
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
