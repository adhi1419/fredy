/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import crypto from 'crypto';
import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS } from './collections.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1;
const PROVIDER_ID_PATTERN = /^[a-z][a-zA-Z0-9-]{0,63}$/;

const credentialsCol = () => FirestoreConnection.collection(COLLECTIONS.PROVIDER_CREDENTIALS);

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function encryptionKey(value = process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY ?? '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9+/]{43}=$/.test(normalized)) {
    throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  const key = Buffer.from(normalized, 'base64');
  if (key.length !== 32 || key.toString('base64') !== normalized) {
    throw new Error('PROVIDER_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

function credentialId(userId, providerId) {
  return crypto.createHash('sha256').update(`${userId}\0${providerId}`).digest('hex');
}

function context(userId, providerId) {
  return Buffer.from(`fredy-provider-credential\0${userId}\0${providerId}\0v${KEY_VERSION}`, 'utf8');
}

function encrypt(secret, userId, providerId, keyValue) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(keyValue), iv);
  cipher.setAAD(context(userId, providerId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    algorithm: ALGORITHM,
    keyVersion: KEY_VERSION,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decrypt(data, userId, providerId, keyValue) {
  if (data?.algorithm !== ALGORITHM || data?.keyVersion !== KEY_VERSION) {
    throw new Error('Provider credential uses an unsupported encryption format.');
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(keyValue), Buffer.from(data.iv, 'base64'));
    decipher.setAAD(context(userId, providerId));
    decipher.setAuthTag(Buffer.from(data.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Provider credential could not be decrypted.');
  }
}

function validatedIdentity(userId, providerId) {
  const safeUserId = requiredText(userId, 'userId');
  const safeProviderId = requiredText(providerId, 'providerId');
  if (!PROVIDER_ID_PATTERN.test(safeProviderId)) throw new Error('providerId is invalid.');
  return { userId: safeUserId, providerId: safeProviderId };
}

/** Read and decrypt one provider credential for its owning user. */
export async function getProviderCredential(userId, providerId, { key } = {}) {
  const identity = validatedIdentity(userId, providerId);
  const snapshot = await credentialsCol().doc(credentialId(identity.userId, identity.providerId)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data.userId !== identity.userId || data.providerId !== identity.providerId) {
    throw new Error('Provider credential ownership metadata is invalid.');
  }
  return {
    secret: decrypt(data, identity.userId, identity.providerId, key),
    revision: data.revision,
  };
}

/** Create the first encrypted credential. Existing credentials are never overwritten. */
export async function createProviderCredential({ userId, providerId, secret, key, now = Date.now() }) {
  const identity = validatedIdentity(userId, providerId);
  const plaintext = requiredText(secret, 'secret');
  const ref = credentialsCol().doc(credentialId(identity.userId, identity.providerId));
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) throw new Error('Provider credential already exists.');
    const revision = 1;
    transaction.create(ref, {
      ...identity,
      ...encrypt(plaintext, identity.userId, identity.providerId, key),
      revision,
      createdAt: now,
      updatedAt: now,
    });
    return revision;
  });
}

/** Replace a rotated credential only when the caller read the current revision. */
export async function rotateProviderCredential({
  userId,
  providerId,
  secret,
  expectedRevision,
  key,
  now = Date.now(),
}) {
  const identity = validatedIdentity(userId, providerId);
  const plaintext = requiredText(secret, 'secret');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('expectedRevision is invalid.');
  const ref = credentialsCol().doc(credentialId(identity.userId, identity.providerId));
  return FirestoreConnection.getConnection().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : null;
    if (data?.revision !== expectedRevision) throw new Error('Provider credential changed during refresh.');
    const revision = expectedRevision + 1;
    transaction.update(ref, {
      ...encrypt(plaintext, identity.userId, identity.providerId, key),
      revision,
      updatedAt: now,
    });
    return revision;
  });
}

/** Delete all provider credentials owned by one Fredy user. */
export async function removeProviderCredentialsForUser(userId) {
  const safeUserId = requiredText(userId, 'userId');
  const snapshot = await credentialsCol().where('userId', '==', safeUserId).get();
  if (snapshot.empty) return;
  const batch = FirestoreConnection.getConnection().batch();
  for (const document of snapshot.docs) batch.delete(document.ref);
  await batch.commit();
}
