/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inquiryDeliveries, mockFredy, setInquiryDeliveryError } from './utils.js';
import { setKnownListingsForRepair, setUserSettings } from './mocks/mockStore.js';
import { setDebugLogSink } from '../lib/services/logger.js';

const decisionEvents = [];
const parsedDecisionEvents = () =>
  decisionEvents
    .filter((entry) => entry.message.startsWith('LISTING_DECISION '))
    .map((entry) => JSON.parse(entry.message.slice('LISTING_DECISION '.length)));

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
  provider: [
    { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } },
    { id: 'deutscheWohnen', applicationPolicy: { automatic: 'enabled' } },
    { id: 'inberlinwohnen', applicationPolicy: { automatic: 'enabled' } },
  ],
  ...overrides,
});

const INQUIRY_PROFILE = {
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
};

const settings = (overrides = {}) => ({ inquiry_profile: INQUIRY_PROFILE, ...overrides });

describe('pipeline automatic inquiry sending', () => {
  beforeEach(() => {
    inquiryDeliveries.length = 0;
    decisionEvents.length = 0;
    setDebugLogSink((entry) => decisionEvents.push(entry));
    setInquiryDeliveryError(null);
    setKnownListingsForRepair([]);
    setUserSettings(settings());
  });

  afterEach(() => {
    setDebugLogSink(null);
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
    expect(parsedDecisionEvents()).toContainEqual({
      event: 'listing_decision',
      schemaVersion: 1,
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      listingId: 'listing-1',
      flow: 'new',
      decision: 'sent',
      reason: 'provider-accepted',
      status: 'sent',
    });
  });

  it('delivers when the configured commute is measured and within budget', async () => {
    setUserSettings(
      settings({
        home_addresses: [{ id: 'Work', label: 'Work', address: 'Office', mode: 'transit', coords: { lat: 1, lng: 2 } }],
      }),
    );
    const Fredy = await mockFredy();
    const instance = pipeline(
      Fredy,
      job({ commuteFilter: { action: 'exclude', limits: { Work: 25 } } }),
      'deutscheWohnen',
    );
    const item = {
      ...listing(),
      link: 'https://www.deutsche-wohnen.com/mieten/mietangebote/test-89-1471120007',
      travelTimes: [{ addressId: 'Work', label: 'Work', mode: 'transit', estimate: true, transit: { minutes: 20 } }],
    };

    await instance._sendInquiryMessages([item]);

    expect(inquiryDeliveries).toHaveLength(1);
  });

  it('fails closed when a limit names an address that is not saved', async () => {
    setUserSettings(
      settings({
        home_addresses: [{ id: 'Work', label: 'Work', address: 'Office', mode: 'transit', coords: { lat: 1, lng: 2 } }],
      }),
    );
    const Fredy = await mockFredy();
    const instance = pipeline(
      Fredy,
      job({ commuteFilter: { action: 'exclude', limits: { 'Old office': 25 } } }),
      'deutscheWohnen',
    );

    await instance._sendInquiryMessages([
      {
        ...listing(),
        travelTimes: [{ addressId: 'Work', label: 'Work', mode: 'transit', estimate: true, transit: { minutes: 20 } }],
      },
    ]);

    expect(inquiryDeliveries).toEqual([]);
    expect(parsedDecisionEvents()).toContainEqual({
      event: 'listing_decision',
      schemaVersion: 1,
      jobId: 'job-1',
      providerId: 'deutscheWohnen',
      listingId: 'listing-1',
      flow: 'new',
      decision: 'skipped',
      reason: 'commute-unmatched-address-limit',
    });
  });

  it.each([
    ['has no travel time', []],
    [
      'is over budget',
      [{ addressId: 'Work', label: 'Work', mode: 'transit', estimate: true, transit: { minutes: 60 } }],
    ],
  ])('fails closed when a listing %s', async (_case, travelTimes) => {
    setUserSettings(
      settings({
        home_addresses: [{ id: 'Work', label: 'Work', address: 'Office', mode: 'transit', coords: { lat: 1, lng: 2 } }],
      }),
    );
    const Fredy = await mockFredy();
    const instance = pipeline(
      Fredy,
      job({ commuteFilter: { action: 'exclude', limits: { Work: 25 } } }),
      'deutscheWohnen',
    );

    await instance._sendInquiryMessages([{ ...listing(), travelTimes }]);

    expect(inquiryDeliveries).toEqual([]);
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
    const multiSourceJob = job({ provider: sources });

    await pipeline(Fredy, multiSourceJob, 'immoscout', null, sources[0])._sendInquiryMessages([listing()]);
    await pipeline(Fredy, multiSourceJob, 'immoscout', null, sources[1])._sendInquiryMessages([listing()]);

    expect(inquiryDeliveries).toHaveLength(1);
  });

  it('does not send for an unsupported capability or an ineligible listing', async () => {
    const Fredy = await mockFredy();
    const enabledJob = job({
      provider: [{ id: 'immoscout', applicationPolicy: { automatic: 'enabled' } }],
    });
    await pipeline(Fredy, enabledJob, 'immoscout', applicationCapabilities.unsupported)._sendInquiryMessages([
      listing(),
    ]);

    const listingScopedJob = job({
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

  it('reuses exact source policy and sends one safely missed known inquiry only once', async () => {
    const Fredy = await mockFredy();
    const row = {
      ...listing(),
      address: 'Main Street 1, Berlin',
      latitude: 52.5,
      longitude: 13.4,
      inquirySendStatus: null,
      notificationComplete: true,
      isActive: true,
    };
    setKnownListingsForRepair([row]);
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } };
    const instance = pipeline(Fredy, job({ provider: [source] }), 'immoscout', null, source);

    await instance.reconcile();
    await instance.reconcile();

    expect(inquiryDeliveries).toHaveLength(1);
    expect(parsedDecisionEvents()).toContainEqual({
      event: 'listing_decision',
      schemaVersion: 1,
      jobId: 'job-1',
      providerId: 'immoscout',
      listingId: 'listing-1',
      flow: 'repair',
      decision: 'sent',
      reason: 'provider-accepted',
      status: 'sent',
    });
  });

  it('never auto-applies to an inactive listing during repair', async () => {
    const Fredy = await mockFredy();
    setKnownListingsForRepair([
      {
        ...listing(),
        latitude: 52.5,
        longitude: 13.4,
        inquirySendStatus: null,
        notificationComplete: true,
        isActive: false,
      },
    ]);
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } };

    await pipeline(Fredy, job({ provider: [source] }), 'immoscout', null, source).reconcile();

    expect(inquiryDeliveries).toEqual([]);
  });

  it('never auto-applies to an archived listing during repair', async () => {
    const Fredy = await mockFredy();
    setKnownListingsForRepair([
      {
        ...listing(),
        latitude: 52.5,
        longitude: 13.4,
        inquirySendStatus: null,
        notificationComplete: true,
        isActive: true,
        lifecycleState: 'archived',
      },
    ]);
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } };

    await pipeline(Fredy, job({ provider: [source] }), 'immoscout', null, source).reconcile();

    expect(inquiryDeliveries).toEqual([]);
  });

  it('applies the same commute safety gate during repair', async () => {
    setUserSettings(
      settings({
        home_addresses: [{ id: 'Work', label: 'Work', address: 'Office', mode: 'transit', coords: { lat: 1, lng: 2 } }],
      }),
    );
    const Fredy = await mockFredy();
    setKnownListingsForRepair([
      {
        ...listing(),
        latitude: 52.5,
        longitude: 13.4,
        inquirySendStatus: null,
        notificationComplete: true,
        isActive: true,
        travelTimes: [{ addressId: 'Work', label: 'Work', mode: 'transit', estimate: true, transit: { minutes: 60 } }],
      },
    ]);
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'enabled' } };
    const guardedJob = job({
      provider: [source],
      commuteFilter: { action: 'exclude', limits: { Work: 25 } },
    });

    await pipeline(Fredy, guardedJob, 'immoscout', null, source).reconcile();

    expect(inquiryDeliveries).toEqual([]);
  });

  it('never repairs an inquiry through a disabled provider source policy', async () => {
    const Fredy = await mockFredy();
    setKnownListingsForRepair([
      {
        ...listing(),
        latitude: 52.5,
        longitude: 13.4,
        inquirySendStatus: null,
        notificationComplete: true,
        isActive: true,
      },
    ]);
    const source = { id: 'immoscout', applicationPolicy: { automatic: 'disabled' } };

    await pipeline(Fredy, job({ provider: [source] }), 'immoscout', null, source).reconcile();

    expect(inquiryDeliveries).toEqual([]);
  });

  it('does nothing when the job did not explicitly enable auto-send', async () => {
    const Fredy = await mockFredy();
    const instance = pipeline(
      Fredy,
      job({ provider: [{ id: 'immoscout', applicationPolicy: { automatic: 'disabled' } }] }),
      'immoscout',
    );
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
