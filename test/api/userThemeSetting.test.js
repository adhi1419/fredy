/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const root = (await import('node:path')).resolve('.');

/** @type {Array<{settings: Record<string, any>, userId: string|null}>} */
let upserted;

/**
 * Register the user-settings plugin against a fastify double and return the theme handler.
 *
 * @param {Record<string, any>} [stored={}] What the calling user already had saved.
 * @returns {Promise<(request: any, reply: any) => Promise<any>>}
 */
async function loadThemeHandler(stored = {}) {
  upserted = [];
  vi.resetModules();
  vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
    getSettings: async () => ({ demoMode: false }),
    getUserSettings: () => stored,
    getAddresses: () => [],
    upsertSettings: (settings, userId = null) => upserted.push({ settings, userId }),
  }));
  vi.doMock(root + '/lib/api/security.js', () => ({ isAdmin: () => true }));
  vi.doMock(root + '/lib/services/geocoding/geoCodingService.js', () => ({ geocodeAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/autocompleteService.js', () => ({ autocompleteAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/distanceService.js', () => ({
    updateDistancesForAddressChange: vi.fn(),
  }));
  vi.doMock(root + '/lib/services/crons/geocoding-cron.js', () => ({ runGeoCordTask: vi.fn() }));

  const plugin = (await import(root + '/lib/api/routes/userSettingsRoute.js')).default;
  const routes = {};
  await plugin({ get: () => {}, post: (path, handler) => (routes[`POST ${path}`] = handler) });
  return routes['POST /theme'];
}

/** A reply double that records what the handler answered. */
function replyDouble() {
  const recorded = { status: 200, payload: undefined };
  return {
    recorded,
    code(status) {
      recorded.status = status;
      return this;
    },
    send(payload) {
      recorded.payload = payload;
      return recorded;
    },
  };
}

describe('POST /api/user/settings/theme', () => {
  /** @type {(request: any, reply: any) => Promise<any>} */
  let handler;

  beforeEach(async () => {
    handler = await loadThemeHandler();
  });

  it.each(['dark', 'light'])('stores %s against the calling user', async (theme) => {
    const reply = replyDouble();
    const result = await handler({ currentUser: { id: 'user-1', isAdmin: true }, body: { theme } }, reply);

    expect(result).toEqual({ success: true });
    expect(upserted).toEqual([{ settings: { theme }, userId: 'user-1' }]);
  });

  it.each([['sepia'], [''], [null], [undefined], [42], ['DARK']])(
    'rejects %s, because the value ends up on an attribute with only two palettes behind it',
    async (theme) => {
      const reply = replyDouble();
      await handler({ currentUser: { id: 'user-1', isAdmin: true }, body: { theme } }, reply);

      expect(reply.recorded.status).toBe(400);
      expect(upserted).toEqual([]);
    },
  );

  it('ignores a userId in the body and writes only the session own preference', async () => {
    const reply = replyDouble();
    await handler({ currentUser: { id: 'user-2', isAdmin: true }, body: { theme: 'light', userId: 'user-1' } }, reply);

    expect(upserted).toEqual([{ settings: { theme: 'light' }, userId: 'user-2' }]);
  });
});
