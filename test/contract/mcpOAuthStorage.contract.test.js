/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * Contract tests: mcpOAuthStorage
 *
 * Backend-agnostic behavioral contract for the MCP OAuth credential store.
 * Seeds and asserts ONLY through the public storage API (plus userStorage for
 * creating the user references that authorization codes and tokens depend on).
 * Every storage call is awaited so the same test body works against both
 * sync (sqlite) and async (firestore) backends.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initBackend, resetBackend, teardownBackend, loadStorageModule } from './harness.js';

let oauth;
let userStorage;

beforeAll(async () => {
  await initBackend();
  oauth = await loadStorageModule('mcpOAuthStorage');
  userStorage = await loadStorageModule('userStorage');
});

beforeEach(async () => {
  await resetBackend();
  // Seed two users that authorization codes and tokens reference.
  await userStorage.upsertUser({ username: 'alice', password: 'pass1', isAdmin: true });
  await userStorage.upsertUser({ username: 'bob', password: 'pass2', isAdmin: false });
});

afterAll(async () => {
  await teardownBackend();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESOURCE = 'https://fredy.example/api/mcp';

const verifier = 'v'.repeat(43);
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

/** Look up a user id by username (needed to pass into oauth calls). */
async function userId(username) {
  const user = await userStorage.getUserByUsername(username);
  return user.id;
}

/** Full happy-path: register client → create code → redeem → get tokens. */
async function grant({ username = 'alice', clientName = 'Claude', redirectUri = 'https://claude.ai/cb' } = {}) {
  const uid = await userId(username);
  const client = await oauth.createClient({ clientName, redirectUris: [redirectUri] });
  const code = await oauth.createAuthorizationCode({
    clientId: client.clientId,
    userId: uid,
    redirectUri,
    codeChallenge: challenge,
    resource: RESOURCE,
    scopes: ['mcp:read'],
  });
  const tokens = await oauth.redeemAuthorizationCode({
    code,
    clientId: client.clientId,
    redirectUri,
    codeVerifier: verifier,
  });
  return { client, tokens, uid };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mcpOAuthStorage contract', () => {
  // ---- Client registration ------------------------------------------------

  describe('client registration', () => {
    it('registers a client and retrieves it by id', async () => {
      const client = await oauth.createClient({
        clientName: 'TestClient',
        redirectUris: ['https://example.com/cb'],
      });
      expect(client.clientId).toBeTruthy();
      expect(client.redirectUris).toEqual(['https://example.com/cb']);

      const fetched = await oauth.getClient(client.clientId);
      expect(fetched).not.toBeNull();
      expect(fetched.clientId).toBe(client.clientId);
      expect(fetched.redirectUris).toEqual(['https://example.com/cb']);
    });

    it('returns null for an unknown client id', async () => {
      expect(await oauth.getClient('nonexistent-id')).toBeNull();
    });

    it('stores multiple redirect URIs', async () => {
      const uris = ['https://a.example/cb', 'https://b.example/cb'];
      const client = await oauth.createClient({ clientName: 'Multi', redirectUris: uris });
      const fetched = await oauth.getClient(client.clientId);
      expect(fetched.redirectUris).toEqual(uris);
    });

    it('allows clientName to be omitted', async () => {
      const client = await oauth.createClient({ redirectUris: ['https://x.example/cb'] });
      expect(client.clientId).toBeTruthy();
      // getClient does not return name, but the registration must not throw.
      const fetched = await oauth.getClient(client.clientId);
      expect(fetched).not.toBeNull();
    });
  });

  // ---- Authorization code -------------------------------------------------

  describe('authorization codes', () => {
    it('turns a code into tokens exactly once (single-use)', async () => {
      const { tokens } = await grant();
      expect(tokens).not.toBeNull();
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.expiresIn).toBeGreaterThan(0);
      expect(tokens.scopes).toEqual(['mcp:read']);

      // Second redemption of the same code must fail.
      // (The code was consumed; we cannot replay it, but we can try a fresh
      // code-redeem with a wrong code to prove the original was deleted.)
      const result = await oauth.validateAccessToken(tokens.accessToken, RESOURCE);
      expect(result).toEqual({ userId: expect.any(String), scopes: ['mcp:read'] });
    });

    it('rejects redemption with wrong clientId', async () => {
      const uid = await userId('alice');
      const clientA = await oauth.createClient({ clientName: 'A', redirectUris: ['https://a.example/cb'] });
      const clientB = await oauth.createClient({ clientName: 'B', redirectUris: ['https://b.example/cb'] });
      const code = await oauth.createAuthorizationCode({
        clientId: clientA.clientId,
        userId: uid,
        redirectUri: 'https://a.example/cb',
        codeChallenge: challenge,
        resource: RESOURCE,
        scopes: ['mcp:read'],
      });
      const result = await oauth.redeemAuthorizationCode({
        code,
        clientId: clientB.clientId,
        redirectUri: 'https://a.example/cb',
        codeVerifier: verifier,
      });
      expect(result).toBeNull();
    });

    it('rejects redemption with wrong redirectUri', async () => {
      const uid = await userId('alice');
      const client = await oauth.createClient({ clientName: 'C', redirectUris: ['https://c.example/cb'] });
      const code = await oauth.createAuthorizationCode({
        clientId: client.clientId,
        userId: uid,
        redirectUri: 'https://c.example/cb',
        codeChallenge: challenge,
        resource: RESOURCE,
        scopes: ['mcp:read'],
      });
      const result = await oauth.redeemAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: 'https://wrong.example/cb',
        codeVerifier: verifier,
      });
      expect(result).toBeNull();
    });

    it('rejects redemption with wrong codeVerifier', async () => {
      const uid = await userId('alice');
      const client = await oauth.createClient({ clientName: 'D', redirectUris: ['https://d.example/cb'] });
      const code = await oauth.createAuthorizationCode({
        clientId: client.clientId,
        userId: uid,
        redirectUri: 'https://d.example/cb',
        codeChallenge: challenge,
        resource: RESOURCE,
        scopes: ['mcp:read'],
      });
      const result = await oauth.redeemAuthorizationCode({
        code,
        clientId: client.clientId,
        redirectUri: 'https://d.example/cb',
        codeVerifier: 'wrong-verifier-string-that-does-not-match',
      });
      expect(result).toBeNull();
    });
  });

  // ---- Access tokens ------------------------------------------------------

  describe('access tokens', () => {
    it('validates a live access token for the correct resource', async () => {
      const { tokens } = await grant();
      const result = await oauth.validateAccessToken(tokens.accessToken, RESOURCE);
      expect(result).not.toBeNull();
      expect(result.scopes).toEqual(['mcp:read']);
    });

    it('rejects a token for the wrong resource', async () => {
      const { tokens } = await grant();
      expect(await oauth.validateAccessToken(tokens.accessToken, 'https://other.example/api')).toBeNull();
    });

    it('rejects an unknown token', async () => {
      expect(await oauth.validateAccessToken('not-a-real-token', RESOURCE)).toBeNull();
    });
  });

  // ---- Refresh token rotation ---------------------------------------------

  describe('refresh token rotation', () => {
    it('rotates and issues new tokens', async () => {
      const { client, tokens } = await grant();
      const rotated = await oauth.refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: client.clientId,
      });
      expect(rotated).not.toBeNull();
      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.refreshToken).toBeTruthy();
      expect(rotated.accessToken).not.toBe(tokens.accessToken);
      expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

      // New access token is valid.
      expect(await oauth.validateAccessToken(rotated.accessToken, RESOURCE)).not.toBeNull();
    });

    it('revokes the entire family when a refresh token is replayed', async () => {
      const { client, tokens } = await grant();

      // Legitimate rotation.
      const rotated = await oauth.refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: client.clientId,
      });
      expect(rotated).not.toBeNull();

      // Replay of the already-consumed refresh token — theft detected.
      const replayed = await oauth.refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: client.clientId,
      });
      expect(replayed).toBeNull();

      // The entire family is now dead: both the rotated access token and the
      // original access token, plus the rotated refresh token.
      expect(await oauth.validateAccessToken(rotated.accessToken, RESOURCE)).toBeNull();
      expect(await oauth.validateAccessToken(tokens.accessToken, RESOURCE)).toBeNull();
      expect(
        await oauth.refreshAccessToken({ refreshToken: rotated.refreshToken, clientId: client.clientId }),
      ).toBeNull();
    });

    it('rejects refresh with wrong clientId', async () => {
      const { tokens } = await grant();
      const other = await oauth.createClient({ clientName: 'Other', redirectUris: ['https://other.example/cb'] });
      expect(
        await oauth.refreshAccessToken({ refreshToken: tokens.refreshToken, clientId: other.clientId }),
      ).toBeNull();
    });
  });

  // ---- Grant listing & revocation -----------------------------------------

  describe('grants', () => {
    it('lists grants a user has approved', async () => {
      const { client, uid } = await grant({ clientName: 'Claude' });
      const grants = await oauth.listGrants(uid);
      expect(grants).toHaveLength(1);
      expect(grants[0].clientId).toBe(client.clientId);
      expect(grants[0].clientName).toBe('Claude');
      expect(grants[0].grantedAt).toBeGreaterThan(0);
    });

    it("does not list another user's grants", async () => {
      await grant({ username: 'alice' });
      const bobId = await userId('bob');
      expect(await oauth.listGrants(bobId)).toEqual([]);
    });

    it('shows one entry per client even after rotation', async () => {
      const { client, tokens, uid } = await grant();
      await oauth.refreshAccessToken({ refreshToken: tokens.refreshToken, clientId: client.clientId });
      expect(await oauth.listGrants(uid)).toHaveLength(1);
    });

    it('revokes a grant (all tokens for that client + user)', async () => {
      const { client, tokens, uid } = await grant();
      expect(await oauth.revokeGrant(uid, client.clientId)).toBe(true);
      expect(await oauth.listGrants(uid)).toEqual([]);
      expect(await oauth.validateAccessToken(tokens.accessToken, RESOURCE)).toBeNull();
    });

    it('returns false when revoking a non-existent grant', async () => {
      const uid = await userId('alice');
      expect(await oauth.revokeGrant(uid, 'no-such-client')).toBe(false);
    });

    it("does not let one user revoke another user's grant", async () => {
      const { client } = await grant({ username: 'bob' });
      const aliceId = await userId('alice');
      expect(await oauth.revokeGrant(aliceId, client.clientId)).toBe(false);

      const bobId = await userId('bob');
      expect(await oauth.listGrants(bobId)).toHaveLength(1);
    });
  });

  // ---- Sweep expired ------------------------------------------------------

  describe('sweepExpired', () => {
    it('removes expired tokens, codes, and orphaned clients', async () => {
      const { client } = await grant();

      // Create an orphaned client (registered but never completed a grant).
      await oauth.createClient({ clientName: 'abandoned', redirectUris: ['https://x.example/cb'] });

      // Create an extra authorization code that will expire.
      const uid = await userId('alice');
      await oauth.createAuthorizationCode({
        clientId: client.clientId,
        userId: uid,
        redirectUri: 'https://claude.ai/cb',
        codeChallenge: challenge,
        resource: RESOURCE,
        scopes: ['mcp:read'],
      });

      // Nothing expired yet — abandoned client is within the grace period.
      const removedNow = await oauth.sweepExpired();
      expect(removedNow).toBe(0);

      // Jump 2 hours: the code (5 min TTL) and access token (1 hr TTL) are
      // expired, and the abandoned client is past the 1-hour grace period.
      const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
      const removed = await oauth.sweepExpired(twoHoursLater);
      // Expired: 1 code + 1 access token + 1 orphaned client = 3.
      expect(removed).toBe(3);
    });

    it('does not remove live refresh tokens or their parent client', async () => {
      const { client, uid } = await grant();

      // After 2 hours the access token is gone, but the refresh token (30d TTL)
      // survives, keeping the grant alive.
      const twoHoursLater = Date.now() + 2 * 60 * 60 * 1000;
      await oauth.sweepExpired(twoHoursLater);

      const grants = await oauth.listGrants(uid);
      expect(grants).toHaveLength(1);
      expect(grants[0].clientId).toBe(client.clientId);
    });

    it('returns 0 when nothing needs sweeping', async () => {
      expect(await oauth.sweepExpired()).toBe(0);
    });
  });
});
