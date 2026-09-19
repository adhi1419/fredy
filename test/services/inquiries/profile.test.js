/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { sanitizeInquiryProfile } from '../../../lib/services/inquiries/profile.js';

describe('sanitizeInquiryProfile', () => {
  it('removes an email override while preserving applicant facts', () => {
    expect(sanitizeInquiryProfile({ name: 'Alice Example', email: 'override@example.net', city: 'Berlin' })).toEqual({
      name: 'Alice Example',
      city: 'Berlin',
    });
  });
});
