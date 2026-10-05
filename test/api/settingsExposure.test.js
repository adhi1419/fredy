/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * A full global settings row set, as `getSettings()` would compile it: operator configuration,
 * the flag the whole UI needs, and a legacy signing secret that must never leave the
 * process.
 */
const STORED_SETTINGS = {
  interval: 60,
  port: 9998,
  baseUrl: 'https://fredy.example',
  session_secret: 'super-secret-signing-key',
  proxyAuthSecret: 'shared-with-the-proxy',
};

const settingsRows = Object.entries(STORED_SETTINGS).map(([name, value]) => ({
  name,
  value: JSON.stringify(value),
}));

vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: {
    collection: () => ({
      where: () => ({
        get: async () => ({ docs: settingsRows.map((row) => ({ data: () => ({ ...row, userId: null }) })) }),
      }),
    }),
  },
}));

const { getSettings, getPublicSettings } = await import('../../lib/services/storage/settingsStorage.js');

describe('settings exposure', () => {
  describe('getPublicSettings', () => {
    it('drops the session secret and the proxy-auth shared secret', async () => {
      const published = await getPublicSettings();
      expect(published).not.toHaveProperty('session_secret');
      expect(published).not.toHaveProperty('proxyAuthSecret');
    });

    it('keeps every non-secret setting', async () => {
      const published = await getPublicSettings();
      for (const name of Object.keys(STORED_SETTINGS)) {
        if (name === 'session_secret' || name === 'proxyAuthSecret') continue;
        expect(published[name]).toEqual(STORED_SETTINGS[name]);
      }
    });

    it('leaves getSettings untouched, so server-side callers still see the secret', async () => {
      const internal = await getSettings();
      expect(internal.session_secret).toBe('super-secret-signing-key');
    });

    it('returns a copy, so a caller cannot mutate the settings cache', async () => {
      const published = await getPublicSettings();
      published.interval = 'tampered';
      expect((await getSettings()).interval).toBe(60);
    });
  });
});
