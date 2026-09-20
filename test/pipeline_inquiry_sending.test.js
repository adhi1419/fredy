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
const applicationCapabilities = {
  immoscout: { automatic: true, eligibility: 'provider' },
  deutscheWohnen: { automatic: true, eligibility: 'provider' },
  inberlinwohnen: { automatic: true, eligibility: 'listing' },
  unsupported: { automatic: false, eligibility: 'none' },
};
const pipeline = (Fredy, jobConfig, providerId, applicationCapability = null, providerSource = null) =>
  new Fredy(providerConfig, jobConfig, providerId, {}, undefined, {
    providerSource: providerSource ?? jobConfig.provider.find((source) => source.id === providerId),
    applicationCapability:
      applicationCapability ?? applicationCapabilities[providerId] ?? applicationCapabilities.unsupported,
  });
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
  provider: [{ id: 'immoscout' }, { id: 'deutscheWohnen' }, { id: 'inberlinwohnen' }],
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
    const instance = pipeline(Fredy, job(), 'immoscout');
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
    const instance = pipeline(Fredy, job(), 'deutscheWohnen');
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
    const instance = pipeline(Fredy, job(), 'inberlinwohnen');
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
    const instance = pipeline(Fredy, job(), 'deutscheWohnen');

    await instance._sendInquiryMessages([listing()]);

    expect(inquiryDeliveries).toEqual([]);
  });

  it('sends only sources enabled and eligible in a mixed-provider job', async () => {
    const Fredy = await mockFredy();
    const mixedJob = job({
      autoSendInquiry: false,
      provider: [
        { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } },
        { id: 'deutscheWohnen', applicationPolicy: { automatic: 'disabled' } },
        { id: 'inberlinwohnen', applicationPolicy: { automatic: 'enabled' } },
      ],
    });

    await pipeline(Fredy, mixedJob, 'immoscout')._sendInquiryMessages([listing()]);
    await pipeline(Fredy, mixedJob, 'deutscheWohnen')._sendInquiryMessages([
      {
        ...listing(),
        link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/test-89-1471120007',
      },
    ]);
    await pipeline(Fredy, mixedJob, 'inberlinwohnen')._sendInquiryMessages([
      {
        ...listing(),
        link: 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html?t=ibw',
        inquiryMessage: null,
      },
    ]);

    expect(inquiryDeliveries.map(({ providerId }) => providerId)).toEqual(['immoscout', 'inberlinwohnen']);
  });

  it('keeps policy attached to the exact source when one provider has multiple URLs', async () => {
    const Fredy = await mockFredy();
    const sources = [
      { id: 'immoscout', url: 'https://example.com/search/disabled', applicationPolicy: { automatic: 'disabled' } },
      { id: 'immoscout', url: 'https://example.com/search/enabled', applicationPolicy: { automatic: 'enabled' } },
    ];
    const multiSourceJob = job({ autoSendInquiry: true, provider: sources });

    await pipeline(Fredy, multiSourceJob, 'immoscout', null, sources[0])._sendInquiryMessages([listing()]);
    await pipeline(Fredy, multiSourceJob, 'immoscout', null, sources[1])._sendInquiryMessages([listing()]);

    expect(inquiryDeliveries).toHaveLength(1);
  });

  it('keeps a legacy job flag as the fallback for a source without policy', async () => {
    const Fredy = await mockFredy();
    const legacyJob = job({ autoSendInquiry: true, provider: [{ id: 'immoscout' }] });

    await pipeline(Fredy, legacyJob, 'immoscout')._sendInquiryMessages([listing()]);

    expect(inquiryDeliveries).toHaveLength(1);
  });

  it('does not send for an unsupported capability or an ineligible listing', async () => {
    const Fredy = await mockFredy();
    const enabledJob = job({
      autoSendInquiry: false,
      provider: [{ id: 'immoscout', applicationPolicy: { automatic: 'enabled' } }],
    });
    await pipeline(Fredy, enabledJob, 'immoscout', applicationCapabilities.unsupported)._sendInquiryMessages([
      listing(),
    ]);

    const listingScopedJob = job({
      autoSendInquiry: false,
      provider: [{ id: 'inberlinwohnen', applicationPolicy: { automatic: 'enabled' } }],
    });
    await pipeline(Fredy, listingScopedJob, 'inberlinwohnen')._sendInquiryMessages([
      {
        ...listing(),
        link: 'https://www.degewo.de/immobilien/1',
        inquiryMessage: null,
      },
    ]);

    expect(inquiryDeliveries).toEqual([]);
  });

  it('does nothing when the job did not explicitly enable auto-send', async () => {
    const Fredy = await mockFredy();
    const instance = pipeline(Fredy, job({ autoSendInquiry: false }), 'immoscout');
    await instance._sendInquiryMessages([listing()]);
    expect(inquiryDeliveries).toEqual([]);
  });

  it('does nothing for unsupported providers or purchase jobs', async () => {
    const Fredy = await mockFredy();
    await pipeline(Fredy, job(), 'inberlinwohnen')._sendInquiryMessages([listing()]);
    await pipeline(Fredy, job({ dealType: 'buy' }), 'immoscout')._sendInquiryMessages([listing()]);
    expect(inquiryDeliveries).toEqual([]);
  });

  it('keeps the pipeline batch alive when delivery fails', async () => {
    const Fredy = await mockFredy();
    const instance = pipeline(Fredy, job(), 'immoscout');
    const items = [listing()];
    setInquiryDeliveryError(new Error('provider unavailable'));
    await expect(instance._sendInquiryMessages(items)).resolves.toBe(items);
  });

  it('skips delivery when generation produced no draft', async () => {
    const Fredy = await mockFredy();
    const instance = pipeline(Fredy, job(), 'immoscout');
    await instance._sendInquiryMessages([{ ...listing(), inquiryMessage: null }]);
    expect(inquiryDeliveries).toEqual([]);
  });
});
