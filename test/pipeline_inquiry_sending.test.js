/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { inquiryDeliveries, mockFredy, setInquiryDeliveryError } from './utils.js';
import { setUserSettings } from './mocks/mockStore.js';

const providerConfig = {
  url: 'https://example.com',
  requiredFieldNames: [],
  filter: () => true,
  normalize: (listing) => listing,
};
const listing = () => ({
  id: 'listing-1',
  link: 'https://www.immobilienscout24.de/expose/170874105',
  inquiryMessage: 'Sehr geehrte Damen und Herren, ...',
});
const job = (overrides = {}) => ({
  id: 'job-1',
  notificationAdapter: [],
  dealType: 'rent',
  autoSendInquiry: true,
  ...overrides,
});

describe('pipeline automatic inquiry sending', () => {
  beforeEach(() => {
    inquiryDeliveries.length = 0;
    setInquiryDeliveryError(null);
    setUserSettings({
      inquiry_profile: {
        name: 'Alice Example',
        email: 'alice@example.com',
        street: 'Main Street',
        houseNumber: '1',
        postcode: '10115',
        city: 'Berlin',
        phoneNumber: '+49 30 123456',
        immoscoutPrivacyAccepted: true,
        deutscheWohnenIncomeType: '1',
        deutscheWohnenMonthlyNetIncome: 'M_3',
        deutscheWohnenPrivacyAccepted: true,
        howogeApplicationAccepted: true,
      },
    });
  });

  it('delivers a generated draft for an enabled ImmoScout rental job', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'immoscout', {}, undefined);
    const item = listing();

    await instance._sendInquiryMessages([item]);

    expect(inquiryDeliveries).toHaveLength(1);
    expect(inquiryDeliveries[0]).toMatchObject({
      providerId: 'immoscout',
      accountEmail: 'user1@example.com',
      message: item.inquiryMessage,
    });
    expect(item.inquirySendStatus).toBe('sent');
  });

  it('delivers a generated draft for an enabled Deutsche Wohnen rental job', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'deutscheWohnen', {}, undefined);
    const item = {
      ...listing(),
      link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/test-89-1471120007',
    };

    await instance._sendInquiryMessages([item]);

    expect(inquiryDeliveries).toHaveLength(1);
    expect(inquiryDeliveries[0]).toMatchObject({
      providerId: 'deutscheWohnen',
      accountEmail: 'user1@example.com',
      message: item.inquiryMessage,
    });
  });

  it('applies to a HOWOGE partner listing without requiring a generated message', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'inberlinwohnen', {}, undefined);
    const item = {
      ...listing(),
      link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html?t=ibw',
      inquiryMessage: null,
    };

    await instance._sendInquiryMessages([item]);

    expect(inquiryDeliveries).toHaveLength(1);
    expect(inquiryDeliveries[0]).toMatchObject({
      providerId: 'inberlinwohnen',
      accountEmail: 'user1@example.com',
      message: '',
    });
    expect(item.inquirySendStatus).toBe('sent');
  });

  it('skips newly supported providers until their profile fields and consent are configured', async () => {
    setUserSettings({ inquiry_profile: { name: 'Alice Example' } });
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'deutscheWohnen', {}, undefined);

    await instance._sendInquiryMessages([listing()]);

    expect(inquiryDeliveries).toEqual([]);
  });

  it('does nothing when the job did not explicitly enable auto-send', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job({ autoSendInquiry: false }), 'immoscout', {}, undefined);
    await instance._sendInquiryMessages([listing()]);
    expect(inquiryDeliveries).toEqual([]);
  });

  it('does nothing for unsupported providers or purchase jobs', async () => {
    const Fredy = await mockFredy();
    await new Fredy(providerConfig, job(), 'inberlinwohnen', {}, undefined)._sendInquiryMessages([listing()]);
    await new Fredy(providerConfig, job({ dealType: 'buy' }), 'immoscout', {}, undefined)._sendInquiryMessages([
      listing(),
    ]);
    expect(inquiryDeliveries).toEqual([]);
  });

  it('keeps the pipeline batch alive when delivery fails', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'immoscout', {}, undefined);
    const items = [listing()];
    setInquiryDeliveryError(new Error('provider unavailable'));
    await expect(instance._sendInquiryMessages(items)).resolves.toBe(items);
  });

  it('skips delivery when generation produced no draft', async () => {
    const Fredy = await mockFredy();
    const instance = new Fredy(providerConfig, job(), 'immoscout', {}, undefined);
    await instance._sendInquiryMessages([{ ...listing(), inquiryMessage: null }]);
    expect(inquiryDeliveries).toEqual([]);
  });
});
