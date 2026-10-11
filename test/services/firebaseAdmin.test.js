/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeApp = vi.fn();
const applicationDefault = vi.fn(() => ({ kind: 'adc' }));

vi.mock('firebase-admin/app', () => ({ initializeApp, applicationDefault }));
vi.mock('../../lib/services/logger.js', () => ({ default: { debug: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  initializeApp.mockReset();
  applicationDefault.mockClear();
  initializeApp.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      options: {
        credential: { getAccessToken: vi.fn().mockResolvedValue({ access_token: 'token' }) },
      },
    };
  });
});

describe('Firebase Admin initialization', () => {
  it('shares one initialization across parallel Google API token requests', async () => {
    const { getGoogleAccessToken } = await import('../../lib/services/firebaseAdmin.js');
    await expect(Promise.all(Array.from({ length: 6 }, () => getGoogleAccessToken()))).resolves.toEqual(
      Array(6).fill('token'),
    );
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(applicationDefault).toHaveBeenCalledTimes(1);
  });
});
