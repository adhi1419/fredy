/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ── Router-level suite ─────────────────────────────────────────────────────────
// Mock everything the listings route pulls in, so this part exercises the pins/ids parsing and
// pass-through and nothing else — modelled on listingsBboxFilter.test.js. The router parses `ids`
// itself (normalizeProviderFilter-style), so no real storage helper is needed here.
vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getAvailableProviders: vi.fn(() => ['immoscout', 'kleinanzeigen']),
  getListingsForMap: vi.fn(() => []),
  getListingById: vi.fn(() => null),
  setListingNotes: vi.fn(() => 1),
  setListingStatus: vi.fn(() => 1),
  deleteListingsByJobId: vi.fn(),
  deleteListingsById: vi.fn(),
  restoreListingsById: vi.fn(),
}));
vi.mock('../../lib/services/storage/watchListStorage.js', () => ({
  toggleWatch: vi.fn(),
  ensureWatch: vi.fn(),
}));
vi.mock('../../lib/services/storage/jobStorage.js', () => ({ getJob: vi.fn(() => null) }));
vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: vi.fn(async () => ({})),
  getUserSettings: vi.fn(() => ({})),
}));
vi.mock('../../lib/services/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../lib/api/security.js', () => ({ isAdmin: vi.fn(() => false) }));

import { queryListings, getAvailableProviders } from '../../lib/services/storage/listingsStorage.js';
import { getJob } from '../../lib/services/storage/jobStorage.js';
import { getUserSettings } from '../../lib/services/storage/settingsStorage.js';
import listingsPlugin from '../../lib/api/routes/listingsRouter.js';

async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.currentUser = { id: 'user-1', isAdmin: false };
  });
  await app.register(listingsPlugin);
  await app.ready();
  return app;
}

const argsFromLastCall = () => queryListings.mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  queryListings.mockReturnValue({ totalNumber: 0, page: 1, result: [] });
  getAvailableProviders.mockReturnValue(['immoscout', 'kleinanzeigen']);
  getJob.mockReturnValue(null);
  getUserSettings.mockReturnValue({});
});

describe('GET /table pins flag (router)', () => {
  it('passes pins:true to queryListings when pins=true', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table?pins=true' });

    expect(response.statusCode).toBe(200);
    expect(argsFromLastCall().pins).toBe(true);
  });

  it('passes pins:false when the flag is absent or not truthy', async () => {
    const app = await buildApp();

    await app.inject({ method: 'GET', url: '/table' });
    expect(argsFromLastCall().pins).toBe(false);

    await app.inject({ method: 'GET', url: '/table?pins=false' });
    expect(argsFromLastCall().pins).toBe(false);
  });

  it('returns the queryListings body plus availableProviders unchanged in pins mode', async () => {
    queryListings.mockReturnValue({
      totalNumber: 3,
      pins: [{ id: 'a', latitude: 50.9, longitude: 7.0, title: 'Flat a', price: 1000, provider: 'immoscout' }],
    });
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table?pins=true' });

    expect(response.json()).toEqual({
      totalNumber: 3,
      pins: [{ id: 'a', latitude: 50.9, longitude: 7.0, title: 'Flat a', price: 1000, provider: 'immoscout' }],
      availableProviders: ['immoscout', 'kleinanzeigen'],
    });
  });
});

describe('GET /table ids filter (router)', () => {
  it('parses a comma-separated ids param into an array', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?ids=a,b,c' });

    expect(argsFromLastCall().idsFilter).toEqual(['a', 'b', 'c']);
  });

  it('accepts repeated ids params and merges them', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?ids=a&ids=b,c' });

    expect(argsFromLastCall().idsFilter).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace and drops empty entries', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?ids=%20a%20,,b%20' });

    expect(argsFromLastCall().idsFilter).toEqual(['a', 'b']);
  });

  it('dedupes repeated ids', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?ids=a,b,a&ids=b' });

    expect(argsFromLastCall().idsFilter).toEqual(['a', 'b']);
  });

  it('passes an empty array when no ids are supplied', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table' });

    expect(argsFromLastCall().idsFilter).toEqual([]);
  });

  it('composes pins and ids with the other filters in one request', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?pins=true&ids=a,b&bbox=6.9,50.9,7.1,51.0&statusFilter=applied' });

    const args = argsFromLastCall();
    expect(args.pins).toBe(true);
    expect(args.idsFilter).toEqual(['a', 'b']);
    expect(args.bbox).toEqual({ west: 6.9, south: 50.9, east: 7.1, north: 51.0 });
    expect(args.statusFilter).toBe('applied');
  });
});
