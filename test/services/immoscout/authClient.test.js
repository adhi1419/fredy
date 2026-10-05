/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getImmoscoutApplicationSession,
  resetImmoscoutApplicationSessionForTests,
} from '../../../lib/services/immoscout/authClient.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function credentialStore(secret = 'refresh-secret') {
  return {
    get: vi.fn().mockResolvedValue(secret ? { secret, revision: 4 } : null),
    rotate: vi.fn().mockResolvedValue(5),
  };
}

function connectedFetch(email = 'applicant@example.com') {
  return vi
    .fn()
    .mockResolvedValueOnce(
      response({ access_token: 'access-secret', refresh_token: 'refresh-secret-2', expires_in: 14400 }),
    )
    .mockResolvedValueOnce(response({ ssoId: 12345, email }))
    .mockResolvedValueOnce(
      response({
        entitlements: [{ serviceType: 'PRIORITY_CONTACT_RENT' }],
        bundles: [{ productType: 'MIETER_PLUS' }],
      }),
    )
    .mockResolvedValueOnce(
      response({
        profileData: { levelOfEmployment: 'PUBLIC_EMPLOYEE', incomeAmount: 5200, hasPets: false },
        statusOfDocuments: [{ documentType: 'SELF_REPORT', present: true }],
      }),
    );
}

describe('ImmoScout application session', () => {
  beforeEach(() => {
    resetImmoscoutApplicationSessionForTests();
  });

  it('loads and rotates the encrypted credential, verifies the account, and caches per user', async () => {
    const fetchImpl = connectedFetch();
    const store = credentialStore();

    const first = await getImmoscoutApplicationSession({
      userId: 'user-1',
      accountEmail: 'Applicant@Example.com',
      credentialStore: store,
      fetchImpl,
      now: 1000,
    });
    const second = await getImmoscoutApplicationSession({
      userId: 'user-1',
      accountEmail: 'applicant@example.com',
      credentialStore: store,
      fetchImpl,
      now: 2000,
    });

    expect(first).toMatchObject({
      accessToken: 'access-secret',
      ssoId: '12345',
      hasMieterPlus: true,
      expiresAt: 14_401_000,
      accountEmail: 'applicant@example.com',
      applicationProfile: {
        employmentRelationship: 'PUBLIC_EMPLOYEE',
        income: 'OVER_5000',
        hasPets: false,
        applicationPackageCompleted: true,
      },
    });
    expect(second).toBe(first);
    expect(store.get).toHaveBeenCalledOnce();
    expect(store.get).toHaveBeenCalledWith('user-1', 'immoscout');
    expect(store.rotate).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'immoscout',
      secret: 'refresh-secret-2',
      expectedRevision: 4,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const tokenRequest = fetchImpl.mock.calls[0][1];
    expect(tokenRequest.method).toBe('POST');
    expect(tokenRequest.body.get('grant_type')).toBe('refresh_token');
    expect(tokenRequest.body.get('refresh_token')).toBe('refresh-secret');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer access-secret');
    expect(fetchImpl.mock.calls[2][1].headers.Authorization).toBe('Bearer access-secret');
  });

  it('keeps cached sessions isolated between Fredy users', async () => {
    const firstFetch = connectedFetch('first@example.com');
    const secondFetch = connectedFetch('second@example.com');

    await getImmoscoutApplicationSession({
      userId: 'user-1',
      accountEmail: 'first@example.com',
      credentialStore: credentialStore('first-refresh'),
      fetchImpl: firstFetch,
    });
    await getImmoscoutApplicationSession({
      userId: 'user-2',
      accountEmail: 'second@example.com',
      credentialStore: credentialStore('second-refresh'),
      fetchImpl: secondFetch,
    });

    expect(firstFetch).toHaveBeenCalledTimes(4);
    expect(secondFetch).toHaveBeenCalledTimes(4);
  });

  it('fails closed when the connected ImmoScout email differs from the Fredy login', async () => {
    const fetchImpl = connectedFetch('different@example.com');

    await expect(
      getImmoscoutApplicationSession({
        userId: 'user-1',
        accountEmail: 'applicant@example.com',
        credentialStore: credentialStore(),
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      phase: 'authentication',
      outcome: 'failed',
      permanent: true,
    });
  });

  it('fails before a request when no account connection is stored', async () => {
    const fetchImpl = vi.fn();

    await expect(
      getImmoscoutApplicationSession({
        userId: 'user-1',
        accountEmail: 'applicant@example.com',
        credentialStore: credentialStore(''),
        fetchImpl,
      }),
    ).rejects.toMatchObject({ phase: 'authentication', outcome: 'failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not expose provider response details when token refresh fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ error: 'invalid_grant', token: 'do-not-copy' }, 400));

    await expect(
      getImmoscoutApplicationSession({
        userId: 'user-1',
        accountEmail: 'applicant@example.com',
        credentialStore: credentialStore(),
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      message: 'ImmoScout account connection failed during token refresh (HTTP 400).',
      status: 400,
      phase: 'authentication',
    });
  });

  it('fails closed when a rotated token cannot be stored', async () => {
    const store = credentialStore();
    store.rotate.mockRejectedValueOnce(new Error('conflict'));

    await expect(
      getImmoscoutApplicationSession({
        userId: 'user-1',
        accountEmail: 'applicant@example.com',
        credentialStore: store,
        fetchImpl: connectedFetch(),
      }),
    ).rejects.toMatchObject({
      message: 'Fredy could not securely store the refreshed ImmoScout connection.',
      phase: 'authentication',
    });
  });
});
