/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Tests for POST /api/listings/:listingId/draft-message.
 *
 * Contract:
 *  - GEMINI_API_KEY unset -> 404, generator never invoked
 *  - not signed in / no listingId -> 400
 *  - listing not accessible to the user -> 404 (getListingById returns null)
 *  - happy path -> 200 with { message }, generator called with the user's
 *    per-user inquiry_profile and the listing
 *  - generator throws -> 502 (no unhandled rejection)
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

let listingsById;
let userSettings;
let generatorImpl;
const generatorCalls = [];

vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  getListingById: async (id, userId) => listingsById[`${userId}:${id}`] ?? null,
  // other exports referenced by the router module at import time:
  queryListings: async () => ({ result: [], totalNumber: 0 }),
  getListingsForMap: async () => [],
  getPriceHistory: async () => [],
  userCanAccessListing: async () => true,
  setListingNotes: async () => 1,
  setListingAddress: async () => 1,
  updateListingGeocoordinates: async () => 1,
  setListingStatus: async () => 1,
  getAvailableProviders: async () => [],
  filterListingIdsForUser: async (ids) => ids,
  deleteListingsByJobId: async () => {},
  deleteListingsById: async () => {},
  restoreListingsById: async () => {},
  reactivateListings: async () => {},
}));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({}),
  getUserSettings: async (userId) => userSettings[userId] ?? {},
}));
vi.mock('../../lib/services/messageGenerator.js', () => ({
  isMessageGeneratorEnabled: () => !!process.env.GEMINI_API_KEY,
  generateInquiryMessage: async (profile, listing) => {
    generatorCalls.push({ profile, listing });
    return generatorImpl(profile, listing);
  },
}));

describe('POST /api/listings/:listingId/draft-message', () => {
  let app;
  let currentUser;

  const build = async () => {
    const plugin = (await import('../../lib/api/routes/listingsRouter.js')).default;
    const instance = Fastify();
    instance.addHook('onRequest', async (request) => {
      request.session = { currentUser };
      request.currentUser = currentUser ? { id: currentUser, isAdmin: false } : undefined;
    });
    await instance.register(plugin, { prefix: '/api/listings' });
    return instance;
  };

  beforeEach(async () => {
    currentUser = 'alice';
    listingsById = { 'alice:L1': { id: 'L1', address: 'Berlin', rooms: 2, size: 60, price: 1300 } };
    userSettings = { alice: { inquiry_profile: { name: 'Alice', employer: 'Amazon' } } };
    generatorImpl = async () => 'Sehr geehrte Damen und Herren, ...';
    generatorCalls.length = 0;
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    app = await build();
  });

  afterEach(async () => {
    delete process.env.GEMINI_API_KEY;
    await app.close();
  });

  const draft = (id) => app.inject({ method: 'POST', url: `/api/listings/${id}/draft-message` });

  it('404s and never calls the generator when GEMINI_API_KEY is unset', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await draft('L1');
    expect(res.statusCode).toBe(404);
    expect(generatorCalls).toHaveLength(0);
  });

  it('404s for a listing the user cannot access', async () => {
    const res = await draft('does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(generatorCalls).toHaveLength(0);
  });

  it('returns 200 with the drafted message and passes the per-user profile + listing', async () => {
    const res = await draft('L1');
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/^Sehr geehrte Damen und Herren/);
    expect(generatorCalls).toHaveLength(1);
    expect(generatorCalls[0].profile).toEqual({ name: 'Alice', employer: 'Amazon' });
    expect(generatorCalls[0].listing.id).toBe('L1');
  });

  it('passes an empty profile object when the user has none set', async () => {
    userSettings = { alice: {} };
    const res = await draft('L1');
    expect(res.statusCode).toBe(200);
    expect(generatorCalls[0].profile).toEqual({});
  });

  it('returns 502 when the generator throws (no unhandled rejection)', async () => {
    generatorImpl = async () => {
      throw new Error('gemini down');
    };
    const res = await draft('L1');
    expect(res.statusCode).toBe(502);
  });
});
