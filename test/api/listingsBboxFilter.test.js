/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ── Router-level suite ─────────────────────────────────────────────────────────
// Mock everything the listings route pulls in, so this part exercises the bbox parsing/pass-through
// and nothing else — modelled on listingsAffordabilityFilter.test.js.
vi.mock('../../lib/services/storage/listingsStorage.js', () => ({
  queryListings: vi.fn(() => ({ totalNumber: 0, page: 1, result: [] })),
  getAvailableProviders: vi.fn(() => []),
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

const bboxFromLastCall = () => queryListings.mock.calls.at(-1)[0].bbox;

beforeEach(() => {
  vi.clearAllMocks();
  queryListings.mockReturnValue({ totalNumber: 0, page: 1, result: [] });
  getAvailableProviders.mockReturnValue([]);
  getJob.mockReturnValue(null);
  getUserSettings.mockReturnValue({});
});

describe('GET /table bbox filter (router)', () => {
  it('parses a valid bbox and passes the object through to queryListings', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table?bbox=6.9,50.9,7.1,51.0' });

    expect(response.statusCode).toBe(200);
    expect(bboxFromLastCall()).toEqual({ west: 6.9, south: 50.9, east: 7.1, north: 51.0 });
  });

  it('passes null when no bbox is supplied', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table' });

    expect(bboxFromLastCall()).toBeNull();
  });

  it('ignores a bbox that is not four numbers, like an incomplete profile', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table?bbox=6.9,50.9,7.1' });

    expect(response.statusCode).toBe(200);
    expect(bboxFromLastCall()).toBeNull();
  });

  it('ignores a non-numeric bbox rather than erroring', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/table?bbox=west,south,east,north' });

    expect(response.statusCode).toBe(200);
    expect(bboxFromLastCall()).toBeNull();
  });

  it('ignores an inverted box (west>east or south>north)', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?bbox=7.1,50.9,6.9,51.0' });
    expect(bboxFromLastCall()).toBeNull();

    await app.inject({ method: 'GET', url: '/table?bbox=6.9,51.0,7.1,50.9' });
    expect(bboxFromLastCall()).toBeNull();
  });

  it('ignores a box with out-of-range longitude or latitude', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?bbox=-181,50.9,7.1,51.0' });
    expect(bboxFromLastCall()).toBeNull();

    await app.inject({ method: 'GET', url: '/table?bbox=6.9,-91,7.1,51.0' });
    expect(bboxFromLastCall()).toBeNull();
  });

  it('keeps the other filters working alongside it', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/table?bbox=6.9,50.9,7.1,51.0&statusFilter=applied&page=2' });

    const args = queryListings.mock.calls.at(-1)[0];
    expect(args.statusFilter).toBe('applied');
    expect(args.page).toBe(2);
    expect(args.bbox).toEqual({ west: 6.9, south: 50.9, east: 7.1, north: 51.0 });
  });
});

// ── Storage-level suite ─────────────────────────────────────────────────────────
// Exercise the real queryListings in-memory bbox filter. The Firestore-touching collaborators of
// listingsCore.impl.js are faked so the filtering semantics (inside/outside/edge/no-coords) can be
// asserted deterministically without the emulator.

const SEEDED = [];

vi.mock('../../lib/services/storage/firestore/listingsShared.js', () => {
  const makeSnapshotDocs = () =>
    SEEDED.map((d) => ({
      id: d.id,
      data: () => d,
    }));
  // The query's filters are not what this suite is about, so the chain ignores them.
  const chainable = (docs) => {
    const query = {
      where: () => query,
      limit: () => query,
      get: async () => ({ docs: docs(), empty: docs().length === 0 }),
    };
    return query;
  };
  return {
    listingsCol: () => chainable(makeSnapshotDocs),
    jobsCol: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
    watchCol: () => chainable(() => []),
    accessibleJobIds: async () => new Set(SEEDED.map((d) => d.jobId)),
    // Minimal API-row projection carrying the fields the filter and pipeline read.
    toApiRow: (snap) => {
      const d = snap.data();
      return {
        id: snap.id,
        job_id: d.jobId ?? null,
        price: d.price ?? null,
        title: d.title ?? null,
        address: d.address ?? null,
        provider: d.provider ?? null,
        link: d.link ?? null,
        is_active: d.isActive ? 1 : 0,
        manually_deleted: d.manuallyDeleted ? 1 : 0,
        latitude: d.latitude ?? null,
        longitude: d.longitude ?? null,
        created_at: d.createdAt ?? null,
      };
    },
    parseListingStatus: (row) => row,
  };
});
vi.mock('../../lib/services/storage/firestore/listingsGeoKpi.impl.js', () => ({
  attachTravelTimes: vi.fn(async (rows) => rows),
}));
vi.mock('../../lib/services/storage/firestore/notificationLedgerStorage.js', () => ({
  deleteDeliveriesForJobId: vi.fn(),
  deleteDeliveriesForListingIds: vi.fn(),
}));
vi.mock('../../lib/services/storage/firestore/knownListingIndex.js', () => ({
  forgetKnownListingIds: vi.fn(),
}));

const { queryListings: coreQueryListings } = await import('../../lib/services/storage/firestore/listingsCore.impl.js');

const seed = (rows) => {
  SEEDED.length = 0;
  SEEDED.push(...rows);
};

const row = (id, overrides = {}) => ({
  id,
  jobId: 'job-1',
  price: 1000,
  title: `Flat ${id}`,
  isActive: true,
  manuallyDeleted: false,
  createdAt: 1,
  ...overrides,
});

// A box over Cologne: lon [6.9, 7.1], lat [50.9, 51.0].
const COLOGNE = { west: 6.9, south: 50.9, east: 7.1, north: 51.0 };

describe('queryListings bbox filter (storage)', () => {
  it('keeps rows inside the box and drops rows outside it', async () => {
    seed([row('inside', { latitude: 50.95, longitude: 7.0 }), row('outside', { latitude: 48.0, longitude: 11.0 })]);

    const { result, totalNumber } = await coreQueryListings({ userId: 'u1', bbox: COLOGNE });

    expect(result.map((r) => r.id)).toEqual(['inside']);
    expect(totalNumber).toBe(1);
  });

  it('includes rows exactly on the edges (inclusive)', async () => {
    seed([
      row('sw-corner', { latitude: 50.9, longitude: 6.9 }),
      row('ne-corner', { latitude: 51.0, longitude: 7.1 }),
      row('just-west', { latitude: 50.95, longitude: 6.899999 }),
    ]);

    const { result } = await coreQueryListings({ userId: 'u1', bbox: COLOGNE });

    expect(result.map((r) => r.id).sort()).toEqual(['ne-corner', 'sw-corner']);
  });

  it('excludes rows without finite coordinates while a bbox is set', async () => {
    seed([
      row('located', { latitude: 50.95, longitude: 7.0 }),
      row('no-coords', { latitude: null, longitude: null }),
      row('nan-coords', { latitude: 'n/a', longitude: 'n/a' }),
    ]);

    const { result, totalNumber } = await coreQueryListings({ userId: 'u1', bbox: COLOGNE });

    expect(result.map((r) => r.id)).toEqual(['located']);
    expect(totalNumber).toBe(1);
  });

  it('keeps coordinate-less rows when no bbox is set', async () => {
    seed([row('located', { latitude: 50.95, longitude: 7.0 }), row('no-coords', { latitude: null, longitude: null })]);

    const { result, totalNumber } = await coreQueryListings({ userId: 'u1' });

    expect(result.map((r) => r.id).sort()).toEqual(['located', 'no-coords']);
    expect(totalNumber).toBe(2);
  });
});
