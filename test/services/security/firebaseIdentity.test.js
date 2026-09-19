/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createFirebaseIdentityResolver,
  IdentityFailure,
  normalizeVerifiedEmail,
} from '../../../lib/services/security/firebaseIdentity.js';

function makeResolver(overrides = {}) {
  const dependencies = {
    verifyToken: vi.fn().mockResolvedValue({
      uid: 'uid-alice',
      email: ' Alice@Example.COM ',
      email_verified: true,
    }),
    getAllowedUser: vi.fn().mockResolvedValue({ email: 'alice@example.com', isAdmin: false }),
    getUserIdentity: vi.fn().mockResolvedValue({
      id: 'uid-alice',
      username: 'alice@example.com',
      isAdmin: false,
    }),
    upsertUser: vi.fn().mockResolvedValue('uid-alice'),
    ...overrides,
  };
  return { resolver: createFirebaseIdentityResolver(dependencies), dependencies };
}

describe('firebase identity resolver', () => {
  it('verifies the token and projects a verified, allowlisted identity', async () => {
    const { resolver, dependencies } = makeResolver();

    await expect(resolver('firebase-token')).resolves.toEqual({
      ok: true,
      currentUser: { id: 'uid-alice', username: 'alice@example.com', isAdmin: false },
    });
    expect(dependencies.verifyToken).toHaveBeenCalledWith('firebase-token');
    expect(dependencies.getAllowedUser).toHaveBeenCalledWith('alice@example.com');
    expect(dependencies.upsertUser).not.toHaveBeenCalled();
  });

  it('reports INVALID_TOKEN when Firebase verification throws', async () => {
    const { resolver, dependencies } = makeResolver({
      verifyToken: vi.fn().mockRejectedValue(new Error('auth/id-token-expired')),
    });

    await expect(resolver('bad-token')).resolves.toEqual({ ok: false, reason: IdentityFailure.INVALID_TOKEN });
    expect(dependencies.getAllowedUser).not.toHaveBeenCalled();
    expect(dependencies.upsertUser).not.toHaveBeenCalled();
  });

  it.each([
    ['uid missing', { email: 'alice@example.com', email_verified: true }],
    ['email missing', { uid: 'uid-alice', email_verified: true }],
    ['email not verified', { uid: 'uid-alice', email: 'alice@example.com', email_verified: false }],
    ['verification claim missing', { uid: 'uid-alice', email: 'alice@example.com' }],
  ])('reports INVALID_CLAIMS when %s', async (_name, claims) => {
    const { resolver, dependencies } = makeResolver({ verifyToken: vi.fn().mockResolvedValue(claims) });

    await expect(resolver('token')).resolves.toEqual({ ok: false, reason: IdentityFailure.INVALID_CLAIMS });
    expect(dependencies.getAllowedUser).not.toHaveBeenCalled();
    expect(dependencies.upsertUser).not.toHaveBeenCalled();
  });

  it('reports NOT_ALLOWED for a verified identity missing from the allowlist', async () => {
    const { resolver, dependencies } = makeResolver({ getAllowedUser: vi.fn().mockResolvedValue(null) });

    await expect(resolver('token')).resolves.toEqual({ ok: false, reason: IdentityFailure.NOT_ALLOWED });
    expect(dependencies.getAllowedUser).toHaveBeenCalledWith('alice@example.com');
    expect(dependencies.upsertUser).not.toHaveBeenCalled();
  });

  it('reads the allowlist on every call and reflects revocation and admin changes immediately', async () => {
    const getAllowedUser = vi
      .fn()
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: false })
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: true })
      .mockResolvedValueOnce(null);
    const { resolver } = makeResolver({ getAllowedUser });

    await expect(resolver('token')).resolves.toMatchObject({ ok: true, currentUser: { isAdmin: false } });
    await expect(resolver('token')).resolves.toMatchObject({ ok: true, currentUser: { isAdmin: true } });
    await expect(resolver('token')).resolves.toEqual({ ok: false, reason: IdentityFailure.NOT_ALLOWED });
    expect(getAllowedUser).toHaveBeenCalledTimes(3);
  });

  it('synchronizes the Fredy projection only when an identity field differs', async () => {
    const getUserIdentity = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'uid-alice', username: 'old@example.com', isAdmin: false })
      .mockResolvedValueOnce({ id: 'uid-alice', username: 'alice@example.com', isAdmin: false });
    const getAllowedUser = vi
      .fn()
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: false })
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: false })
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: false });
    const upsertUser = vi.fn().mockResolvedValue('uid-alice');
    const { resolver } = makeResolver({ getUserIdentity, getAllowedUser, upsertUser });

    await resolver('token'); // missing projection -> provision
    await resolver('token'); // username differs -> update
    await resolver('token'); // identical projection -> no write

    expect(upsertUser).toHaveBeenCalledTimes(2);
    expect(upsertUser).toHaveBeenNthCalledWith(1, {
      userId: 'uid-alice',
      username: 'alice@example.com',
      isAdmin: false,
    });
    expect(upsertUser).toHaveBeenNthCalledWith(2, {
      userId: 'uid-alice',
      username: 'alice@example.com',
      isAdmin: false,
    });
  });
});

describe('verified-email normalization', () => {
  it('trims and lowercases a Firebase email claim', () => {
    expect(normalizeVerifiedEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it.each([undefined, null, '', '   '])('rejects an empty or non-string claim: %o', (email) => {
    expect(normalizeVerifiedEmail(email)).toBeNull();
  });
});
