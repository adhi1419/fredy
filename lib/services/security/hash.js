/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'crypto';

/**
 * Password hashing utilities.
 *
 * Hashes use scrypt with a per-user random salt and are serialized as
 * `scrypt$N$r$p$saltHex$hashHex` so that parameters can be evolved later
 * without breaking existing users.
 */

// scrypt parameters. N must be a power of 2. These defaults follow the
// current OWASP guidance for interactive login (memory ~ 32 MiB) and stay
// safely below Node's default `maxmem` of 32 MiB * r * p * 128 headroom
// (we bump maxmem explicitly to be robust across Node versions).
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2; // generous headroom

const SCRYPT_PREFIX = 'scrypt$';

const scryptDerive = (password, salt, N, r, p) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, KEY_LEN, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });

/**
 * Hash a password using scrypt with a fresh random salt.
 * @param {string} password
 * @returns {Promise<string>} Encoded hash string.
 */
export const hash = async (password) => {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = await scryptDerive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `${SCRYPT_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
};

/**
 * A well-formed scrypt hash of a value nobody can supply, for the "user does not exist" branch of
 * a login.
 *
 * Verifying against it costs the same as verifying a real password, so the response time no longer
 * says whether an account exists. The salt is fixed and the digest is deliberately unreachable -
 * `verify` will always return false for it, since no input derives to an all-zero key.
 * @type {string}
 */
export const DUMMY_HASH = `${SCRYPT_PREFIX}${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${'00'.repeat(SALT_LEN)}$${'00'.repeat(
  KEY_LEN,
)}`;

/**
 * Verify a plaintext password against a stored scrypt hash.
 *
 * @param {string} password - Plaintext password supplied by the user.
 * @param {string} stored - Hash previously produced by {@link hash}.
 * @returns {Promise<boolean>} True when the password matches.
 */
export const verify = async (password, stored) => {
  if (stored == null || typeof stored !== 'string' || stored.length === 0) return false;

  if (stored.startsWith(SCRYPT_PREFIX)) {
    const parts = stored.slice(SCRYPT_PREFIX.length).split('$');
    if (parts.length !== 5) return false;
    const N = Number.parseInt(parts[0], 10);
    const r = Number.parseInt(parts[1], 10);
    const p = Number.parseInt(parts[2], 10);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N <= 1 || r <= 0 || p <= 0) {
      return false;
    }
    let salt;
    let expected;
    try {
      salt = Buffer.from(parts[3], 'hex');
      expected = Buffer.from(parts[4], 'hex');
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;
    let derived;
    try {
      derived = await scryptDerive(password, salt, N, r, p);
    } catch {
      return false;
    }
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }

  return false;
};
