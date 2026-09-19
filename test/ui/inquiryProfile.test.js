/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { isInquiryContactProfileReady } from '../../ui/src/services/inquiries/profile.js';

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
});
