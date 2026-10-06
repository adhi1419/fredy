/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockFredy } from './utils.js';
import { setUserSettings } from './mocks/mockStore.js';

const generateInquiryMessage = vi.hoisted(() => vi.fn().mockResolvedValue('Generated message'));
vi.mock('../lib/services/messageGenerator.js', () => ({
  generateInquiryMessage,
  isMessageGeneratorEnabled: () => true,
}));

const providerConfig = {
  url: 'https://example.com',
  requiredFieldNames: [],
  filter: () => true,
  normalize: (listing) => listing,
};

const job = {
  id: 'job-1',
  userId: 'user1',
  dealType: 'rent',
  notificationAdapter: [],
  specFilter: null,
  spatialFilter: null,
  provider: [],
};

const listing = (link) => ({
  id: 'listing-1',
  link,
  title: 'Two-room apartment',
  price: 800,
  size: 60,
  rooms: 2,
  description: 'Bright apartment',
});

describe('pipeline inquiry drafting', () => {
  beforeEach(() => {
    generateInquiryMessage.mockClear();
    setUserSettings({ inquiry_profile: { name: 'Alice Example' } });
  });

  it('does not generate a message for a direct WBM form', async () => {
    const Fredy = await mockFredy();
    const item = listing('https://www.wbm.de/wohnungen-berlin/angebote/details/example/');
    const instance = new Fredy(providerConfig, job, 'wbm', {});

    await instance._generateInquiryMessages([item]);

    expect(generateInquiryMessage).not.toHaveBeenCalled();
    expect(item.inquiryMessage).toBeUndefined();
  });

  it('still generates messages for providers whose forms require one', async () => {
    const Fredy = await mockFredy();
    const item = listing('https://www.immobilienscout24.de/expose/123');
    const instance = new Fredy(providerConfig, job, 'immoscout', {});

    await instance._generateInquiryMessages([item]);

    expect(generateInquiryMessage).toHaveBeenCalledOnce();
    expect(item.inquiryMessage).toBe('Generated message');
  });
});
