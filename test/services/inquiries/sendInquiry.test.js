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
    expect(supportsInquirySending('kleinanzeigen')).toBe(true);
    expect(inquiryRequiresMessage('kleinanzeigen')).toBe(true);
    expect(supportsInquirySending('inberlinwohnen')).toBe(true);
    const howoge = {
      link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html',
    };
    const wbm = { link: 'https://www.wbm.de/wohnungen-berlin/angebote/details/example/' };
    const stadtUndLand = { link: 'https://stadtundland.de/wohnungssuche/1001%2F7318%2F00031' };
    expect(supportsInquirySending('inberlinwohnen', howoge)).toBe(true);
    expect(supportsInquirySending('inberlinwohnen', wbm)).toBe(true);
    expect(supportsInquirySending('inberlinwohnen', stadtUndLand)).toBe(true);
    expect(supportsInquirySending('inberlinwohnen', { link: 'https://www.degewo.de/immobilien/test' })).toBe(false);
    expect(inquiryRequiresMessage('inberlinwohnen', howoge)).toBe(false);
    expect(inquiryRequiresMessage('inberlinwohnen', wbm)).toBe(false);
    expect(inquiryRequiresMessage('inberlinwohnen', stadtUndLand)).toBe(false);
  });
});
