/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import { inquiryRequiresMessage, supportsInquirySending } from '../../../lib/services/inquiries/sendInquiry.js';

describe('inquiry sender registry', () => {
  it('registers supported application providers and partner flows', () => {
    expect(supportsInquirySending('immoscout')).toBe(true);
    expect(supportsInquirySending('deutscheWohnen')).toBe(true);
    expect(supportsInquirySending('inberlinwohnen')).toBe(true);
    expect(
      supportsInquirySending('inberlinwohnen', {
        link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html',
      }),
    ).toBe(true);
    expect(supportsInquirySending('inberlinwohnen', { link: 'https://www.degewo.de/immobilien/test' })).toBe(false);
    expect(
      inquiryRequiresMessage('inberlinwohnen', {
        link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html',
      }),
    ).toBe(false);
  });
});
