/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const root = path.resolve('.');
let upserted;
let upsertError;

async function loadInquiryProfileHandler() {
  upserted = [];
  upsertError = null;
  vi.resetModules();
  vi.doMock(root + '/lib/services/storage/settingsStorage.js', () => ({
    getSettings: async () => ({ demoMode: false }),
    getUserSettings: async () => ({}),
    getAddresses: () => [],
    upsertSettings: async (settings, userId) => {
      if (upsertError) throw upsertError;
      upserted.push({ settings, userId });
    },
  }));
  vi.doMock(root + '/lib/api/security.js', () => ({ isAdmin: () => false }));
  vi.doMock(root + '/lib/services/geocoding/geoCodingService.js', () => ({ geocodeAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/autocompleteService.js', () => ({ autocompleteAddress: vi.fn() }));
  vi.doMock(root + '/lib/services/geocoding/distanceService.js', () => ({ updateDistancesForAddressChange: vi.fn() }));
  vi.doMock(root + '/lib/services/crons/geocoding-cron.js', () => ({ runGeoCordTask: vi.fn() }));

  const plugin = (await import(root + '/lib/api/routes/userSettingsRoute.js')).default;
  const routes = {};
  await plugin({
    get: () => {},
    post: (route, handler) => {
      routes[`POST ${route}`] = handler;
    },
  });
  return routes['POST /inquiry-profile'];
}

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

const completeProfile = {
  name: 'Alice Example',
  street: 'Main Street',
  houseNumber: '1',
  postcode: '10115',
  city: 'Berlin',
  employer: 'Example GmbH',
  deutscheWohnenPrivacyAccepted: false,
  email: 'must-not-be-stored@example.test',
};

describe('POST /api/user/settings/inquiry-profile onboarding contract', () => {
  let handler;

  beforeEach(async () => {
    handler = await loadInquiryProfileHandler();
  });

  it('validates common fields, preserves provider fields, and strips email before storage', async () => {
    const reply = replyDouble();
    const result = await handler(
      {
        currentUser: { id: 'user-1' },
        body: { inquiry_profile: completeProfile, validate_common: true },
      },
      reply,
    );

    expect(result).toEqual({
      success: true,
      inquiry_profile: {
        name: 'Alice Example',
        street: 'Main Street',
        houseNumber: '1',
        postcode: '10115',
        city: 'Berlin',
        employer: 'Example GmbH',
        deutscheWohnenPrivacyAccepted: false,
      },
    });
    expect(upserted).toEqual([
      {
        settings: { inquiry_profile: result.inquiry_profile },
        userId: 'user-1',
      },
    ]);
  });

  it('rejects incomplete common fields before persistence', async () => {
    const reply = replyDouble();
    await handler(
      {
        currentUser: { id: 'user-1' },
        body: { inquiry_profile: { name: 'Alice Example', city: 'Berlin' }, validate_common: true },
      },
      reply,
    );

    expect(reply.recorded.status).toBe(400);
    expect(reply.recorded.payload).toEqual({ error: 'Common applicant profile fields are incomplete.' });
    expect(upserted).toEqual([]);
  });

  it('keeps My account edits optional when onboarding validation is not requested', async () => {
    const reply = replyDouble();
    const result = await handler(
      { currentUser: { id: 'user-1' }, body: { inquiry_profile: { name: 'Alice Example' } } },
      reply,
    );

    expect(result).toEqual({ success: true, inquiry_profile: { name: 'Alice Example' } });
    expect(upserted).toHaveLength(1);
  });

  it('returns a server error and does not claim completion when persistence fails', async () => {
    upsertError = new Error('emulator unavailable');
    const reply = replyDouble();
    await handler(
      { currentUser: { id: 'user-1' }, body: { inquiry_profile: completeProfile, validate_common: true } },
      reply,
    );

    expect(reply.recorded.status).toBe(500);
    expect(reply.recorded.payload).toEqual({ error: 'emulator unavailable' });
    expect(upserted).toEqual([]);
  });
});
