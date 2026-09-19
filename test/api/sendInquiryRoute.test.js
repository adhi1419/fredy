/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryDeliveryError } from '../../lib/services/inquiries/errors.js';

let currentUser;
let listing;
let ownerId;
let profile;
let deliveryImpl;
const deliveryCalls = [];

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  getListingById: async () => listing,
  queryListings: async () => ({ result: [], totalNumber: 0 }),
  getListingsForMap: async () => [],
  getPriceHistory: async () => [],
  userCanAccessListing: async () => true,
  setListingNotes: async () => 1,
  setListingAddress: async () => 1,
  updateListingGeocoordinates: async () => 1,
  setListingStatus: async () => 1,
  setInquiryMessage: async () => 1,
  reserveInquirySend: async () => true,
  finishInquirySend: async () => 1,
  getAvailableProviders: async () => [],
  filterListingIdsForUser: async (ids) => ids,
  deleteListingsByJobId: async () => {},
  deleteListingsById: async () => {},
  restoreListingsById: async () => {},
  reactivateListings: async () => {},
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({}),
  getUserSettings: async () => ({ inquiry_profile: profile }),
}));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({
  getJob: async () => ({ id: 'J1', userId: ownerId }),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({ toggleWatch: vi.fn(), ensureWatch: vi.fn() }));
vi.mock('../../lib/services/messageGenerator.js', () => ({
  isMessageGeneratorEnabled: () => false,
  generateInquiryMessage: vi.fn(),
}));
vi.mock('../../lib/services/inquiries/sendInquiry.js', () => ({
  supportsInquirySending: (providerId, candidate) =>
    ['deutscheWohnen', 'immoscout'].includes(providerId) ||
    (providerId === 'inberlinwohnen' && candidate?.link?.includes('howoge.de')),
  inquiryRequiresMessage: (providerId, candidate) =>
    !(providerId === 'inberlinwohnen' && candidate?.link?.includes('howoge.de')),
}));
vi.mock('../../lib/services/inquiries/deliverInquiry.js', () => ({
  deliverInquiry: async (params) => {
    deliveryCalls.push(params);
    return deliveryImpl(params);
  },
}));

describe('POST /api/listings/:listingId/send-inquiry', () => {
  let app;

  beforeEach(async () => {
    currentUser = 'alice';
    ownerId = 'alice';
    listing = {
      id: 'L1',
      job_id: 'J1',
      provider: 'immoscout',
      link: 'https://www.immobilienscout24.de/expose/170874105',
    };
    profile = { name: 'Alice Example', email: 'alice@example.com' };
    deliveryImpl = async () => ({ started: true, status: 'sent', requestId: 'request-1', sentAt: 1234 });
    deliveryCalls.length = 0;
    vi.resetModules();

    const plugin = (await import('../../lib/api/routes/listingsRouter.js')).default;
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      request.currentUser = { id: currentUser, isAdmin: false };
      request.currentUser = { id: currentUser, username: `${currentUser}@example.com`, isAdmin: false };
    });
    await app.register(plugin, { prefix: '/api/listings' });
  });

  afterEach(async () => app.close());

  const send = (message = 'Hallo') =>
    app.inject({ method: 'POST', url: '/api/listings/L1/send-inquiry', payload: { message } });

  it('sends the edited message with the job owner profile', async () => {
    const response = await send('Edited inquiry');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'sent', requestId: 'request-1' });
    expect(deliveryCalls).toHaveLength(1);
    expect(deliveryCalls[0]).toMatchObject({
      providerId: 'immoscout',
      profile,
      accountEmail: 'alice@example.com',
      message: 'Edited inquiry',
    });
  });

  it('routes Deutsche Wohnen through the same owner-only delivery coordinator', async () => {
    listing.provider = 'deutscheWohnen';
    listing.link = 'https://www.deutsche-wohnen.com/mieten/mietangebote/test-89-1471120007';
    const response = await send('Edited Deutsche Wohnen inquiry');
    expect(response.statusCode).toBe(200);
    expect(deliveryCalls[0]).toMatchObject({
      providerId: 'deutscheWohnen',
      accountEmail: 'alice@example.com',
      message: 'Edited Deutsche Wohnen inquiry',
    });
  });

  it('allows a HOWOGE application without custom message text', async () => {
    listing.provider = 'inberlinwohnen';
    listing.link = 'https://www.howoge.de/immobiliensuche/wohnungssuche/detail/1770-20776-16.html?t=ibw';
    const response = await send('');
    expect(response.statusCode).toBe(200);
    expect(deliveryCalls[0]).toMatchObject({
      providerId: 'inberlinwohnen',
      accountEmail: 'alice@example.com',
      message: '',
    });
  });

  it('rejects a shared-job viewer even when they can read the listing', async () => {
    ownerId = 'bob';
    const response = await send();
    expect(response.statusCode).toBe(403);
    expect(deliveryCalls).toHaveLength(0);
  });

  it('rejects unsupported providers', async () => {
    listing.provider = 'inberlinwohnen';
    const response = await send();
    expect(response.statusCode).toBe(400);
  });

  it('returns conflict when another attempt already reserved the listing', async () => {
    deliveryImpl = async () => ({ started: false, status: 'sent' });
    const response = await send();
    expect(response.statusCode).toBe(409);
    expect(response.json().status).toBe('sent');
  });

  it('returns missing profile fields without hiding them', async () => {
    deliveryImpl = async () => {
      throw new InquiryDeliveryError('Applicant profile is missing: address.', { missingFields: ['address'] });
    };
    const response = await send();
    expect(response.statusCode).toBe(422);
    expect(response.json().missingFields).toEqual(['address']);
  });

  it('returns unknown status after an ambiguous provider outcome', async () => {
    deliveryImpl = async () => {
      throw new InquiryDeliveryError('The ImmoScout inquiry outcome is unknown.', { outcome: 'unknown' });
    };
    const response = await send();
    expect(response.statusCode).toBe(502);
    expect(response.json().status).toBe('unknown');
  });
});
