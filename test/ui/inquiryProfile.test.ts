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

  it('checks Deutsche Wohnen phone and income selections separately', () => {
    const deutscheWohnenProfile = {
      name: 'Alice Example',
      phoneNumber: '+49 30 123456',
      deutscheWohnenIncomeType: '1',
      deutscheWohnenMonthlyNetIncome: 'M_3',
    };
    expect(isInquiryContactProfileReady(deutscheWohnenProfile, 'deutscheWohnen')).toBe(true);
    expect(isInquiryContactProfileReady({ ...deutscheWohnenProfile, phoneNumber: '' }, 'deutscheWohnen')).toBe(false);
  });

  it('supports HOWOGE, WBM, and Stadt und Land with separate profile requirements', () => {
    const howogeListing = {
      link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html',
    };
    const wbmListing = { link: 'https://www.wbm.de/wohnungen-berlin/angebote/details/example/' };
    const stadtListing = { link: 'https://stadtundland.de/wohnungssuche/1001%2F7318%2F00031' };
    expect(isInquiryProviderSupported('immoscout')).toBe(true);
    expect(isInquiryProviderSupported('deutscheWohnen')).toBe(true);
    expect(isInquiryProviderSupported('kleinanzeigen')).toBe(true);
    expect(isInquiryContactProfileReady({ name: 'Alice Example' }, 'kleinanzeigen')).toBe(true);
    expect(inquiryProviderRequiresMessage('kleinanzeigen')).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen')).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', howogeListing)).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', wbmListing)).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', stadtListing)).toBe(true);
    expect(isInquiryProviderSupported('inberlinwohnen', { link: 'https://www.degewo.de/test' })).toBe(false);
    expect(inquiryProviderRequiresMessage('inberlinwohnen', howogeListing)).toBe(false);
    expect(inquiryProviderRequiresMessage('inberlinwohnen', wbmListing)).toBe(false);
    expect(inquiryProviderRequiresMessage('inberlinwohnen', stadtListing)).toBe(false);
    expect(isInquiryContactProfileReady({ name: 'Alice Example' }, 'inberlinwohnen', howogeListing)).toBe(true);
    expect(
      isInquiryContactProfileReady(
        {
          name: 'Alice Example',
          salutation: 'Frau',
          wbsAvailable: false,
        },
        'inberlinwohnen',
        wbmListing,
      ),
    ).toBe(true);
    expect(
      isInquiryContactProfileReady(
        {
          name: 'Alice Example',
          salutation: 'Frau',
          numberOfPersons: '2',
          numberOfChildren: '0',
          moveInDate: '01.11.2026',
          netIncome: '3500 €',
          wbsAvailable: false,
        },
        'inberlinwohnen',
        stadtListing,
      ),
    ).toBe(true);
  });
});
