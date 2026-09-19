/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAllowedUser: vi.fn(),
  getUserIdentity: vi.fn(),
  upsertUser: vi.fn(),
}));

vi.mock('../../lib/services/firebaseAdmin.js', () => ({ verifyIdToken: mocks.verifyIdToken }));
vi.mock('../../lib/services/storage/firestore/allowedUsersStorage.js', () => ({
  getAllowedUser: mocks.getAllowedUser,
}));
vi.mock('../../lib/services/storage/userStorage.js', () => ({
  getUserIdentity: mocks.getUserIdentity,
  upsertUser: mocks.upsertUser,
}));

import { adminHook, authHook, normalizeVerifiedEmail, parseBearerToken } from '../../lib/api/security.js';

function makeReply() {
  return {
    statusCode: null,
    payload: undefined,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
  };
}

const requestWithToken = (token = 'token') => ({
  headers: { authorization: `Bearer ${token}` },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({
    uid: 'uid-alice',
    email: 'Alice@Example.COM',
    email_verified: true,
  });
  mocks.getAllowedUser.mockResolvedValue({ email: 'alice@example.com', isAdmin: false });
  mocks.getUserIdentity.mockResolvedValue({ id: 'uid-alice', username: 'alice@example.com', isAdmin: false });
});

describe('parseBearerToken', () => {
  it.each([
    [undefined, 'missing header'],
    ['', 'empty header'],
    ['Basic token', 'wrong scheme'],
    ['Bearer', 'missing token'],
    ['Bearer token with spaces', 'token contains spaces'],
    ['Bearer token, Bearer other', 'comma-joined duplicate values'],
  ])('rejects %s (%s)', (authorization) => {
    expect(parseBearerToken({ headers: { authorization } })).toBeNull();
  });

  it('accepts one bearer value regardless of scheme casing', () => {
    expect(parseBearerToken({ headers: { authorization: 'bEaReR firebase-token' } })).toBe('firebase-token');
  });

  it('rejects repeated authorization headers', () => {
    expect(parseBearerToken({ headers: { authorization: ['Bearer first', 'Bearer second'] } })).toBeNull();
    expect(
      parseBearerToken({
        headers: { authorization: 'Bearer first' },
        raw: { rawHeaders: ['Authorization', 'Bearer first', 'authorization', 'Bearer second'] },
      }),
    ).toBeNull();
  });
});

describe('normalizeVerifiedEmail', () => {
  it('trims and lowercases a Firebase email claim', () => {
    expect(normalizeVerifiedEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it.each([undefined, null, '', '   '])('rejects an empty or non-string claim: %o', (email) => {
    expect(normalizeVerifiedEmail(email)).toBeNull();
  });
});

describe('authHook', () => {
  it('returns 401 and does not verify when the bearer header is missing or malformed', async () => {
    const reply = makeReply();

    await authHook({ headers: { authorization: 'Basic not-a-firebase-token' } }, reply);

    expect(reply.statusCode).toBe(401);
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.getAllowedUser).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it('returns 401 when Firebase verification fails', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('auth/id-token-expired'));
    const reply = makeReply();

    await authHook(requestWithToken(), reply);

    expect(reply.statusCode).toBe(401);
    expect(mocks.getAllowedUser).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ email: 'alice@example.com', email_verified: true }, 'uid missing'],
    [{ uid: 'uid-alice', email_verified: true }, 'email missing'],
    [{ uid: 'uid-alice', email: 'alice@example.com', email_verified: false }, 'email not verified'],
    [{ uid: 'uid-alice', email: 'alice@example.com' }, 'verification claim missing'],
  ])('returns 401 for invalid verified identity claims (%s)', async (claims) => {
    mocks.verifyIdToken.mockResolvedValue(claims);
    const reply = makeReply();

    await authHook(requestWithToken(), reply);

    expect(reply.statusCode).toBe(401);
    expect(mocks.getAllowedUser).not.toHaveBeenCalled();
    expect(mocks.upsertUser).not.toHaveBeenCalled();
  });

  it('normalizes the verified email, provisions a missing Firebase UID, and sets request.currentUser', async () => {
    mocks.getUserIdentity.mockResolvedValue(null);
    const request = requestWithToken();
    const reply = makeReply();

    await authHook(request, reply);

    expect(reply.statusCode).toBeNull();
    expect(mocks.getAllowedUser).toHaveBeenCalledWith('alice@example.com');
    expect(mocks.upsertUser).toHaveBeenCalledWith({
      userId: 'uid-alice',
      username: 'alice@example.com',
      isAdmin: false,
    });
    expect(request.currentUser).toEqual({ id: 'uid-alice', username: 'alice@example.com', isAdmin: false });
  });

  it('returns 403 for a verified Firebase identity missing from the allowlist', async () => {
    mocks.getAllowedUser.mockResolvedValue(null);
    const request = requestWithToken();
    request.currentUser = { id: 'attacker-controlled-id', isAdmin: true };
    const reply = makeReply();

    await authHook(request, reply);

    expect(reply.statusCode).toBe(403);
    expect(mocks.upsertUser).not.toHaveBeenCalled();
    expect(request.currentUser).toBeUndefined();
  });

  it('reads the allowlist on every request and applies revocation and admin changes immediately', async () => {
    const request = requestWithToken();
    const reply = makeReply();

    mocks.getAllowedUser
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: false })
      .mockResolvedValueOnce({ email: 'alice@example.com', isAdmin: true })
      .mockResolvedValueOnce(null);

    await authHook(request, reply);
    expect(request.currentUser).toMatchObject({ id: 'uid-alice', isAdmin: false });

    const promotedRequest = requestWithToken();
    await authHook(promotedRequest, makeReply());
    expect(promotedRequest.currentUser).toMatchObject({ id: 'uid-alice', isAdmin: true });

    const revokedReply = makeReply();
    await authHook(requestWithToken(), revokedReply);
    expect(revokedReply.statusCode).toBe(403);
    expect(mocks.getAllowedUser).toHaveBeenCalledTimes(3);
    expect(mocks.upsertUser).toHaveBeenCalledTimes(1);
  });
});

describe('adminHook', () => {
  it('allows an allowlist-derived administrator', async () => {
    const reply = makeReply();
    await adminHook({ currentUser: { isAdmin: true } }, reply);
    expect(reply.statusCode).toBeNull();
  });

  it('returns 403 for an authenticated non-admin', async () => {
    const reply = makeReply();
    await adminHook({ currentUser: { isAdmin: false } }, reply);
    expect(reply.statusCode).toBe(403);
  });
});
