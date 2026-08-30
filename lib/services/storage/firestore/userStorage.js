/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * userStorage — Firestore implementation.
 * Same public API as the SQLite implementation; async where that one is sync.
 */

import * as hasher from '../../security/hash.js';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS } from './collections.js';
import { getSettings } from './settingsStorage.js';
import { removeJobsByUserId } from './jobStorage.js';
import { inDevMode } from '../../../utils.js';

const generateMcpToken = () => `fredy_${crypto.randomBytes(32).toString('hex')}`;

export const ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin';
export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'demo';

const usersCol = () => FirestoreConnection.collection(COLLECTIONS.USERS);
const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);

async function jobsCountFor(userId) {
  const agg = await jobsCol().where('userId', '==', userId).count().get();
  return agg.data().count;
}

function publicUser(id, data, numberOfJobs) {
  return {
    id,
    username: data.username,
    lastLogin: data.lastLogin ?? null,
    isAdmin: !!data.isAdmin,
    numberOfJobs,
  };
}

/** All users, credentials excluded, ordered by username. */
export const getUsers = async () => {
  const snapshot = await usersCol().orderBy('username').get();
  return Promise.all(snapshot.docs.map(async (d) => publicUser(d.id, d.data(), await jobsCountFor(d.id))));
};

export const getUserWithSecretsByUsername = async (username) => {
  const snapshot = await usersCol().where('username', '==', username).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data();
  return { id: doc.id, username: data.username, password: data.password, isAdmin: !!data.isAdmin };
};

export const getMcpToken = async (id) => {
  if (!id || typeof id !== 'string') return null;
  const snap = await usersCol().doc(id).get();
  return snap.exists ? (snap.data().mcpToken ?? null) : null;
};

export const getUser = async (id) => {
  if (!id || typeof id !== 'string') return null;
  const snap = await usersCol().doc(id).get();
  if (!snap.exists) return null;
  return publicUser(snap.id, snap.data(), await jobsCountFor(snap.id));
};

export const getUserByUsername = async (username) => {
  const user = await getUserWithSecretsByUsername(username);
  if (user == null) return null;
  return { id: user.id, username: user.username, isAdmin: !!user.isAdmin };
};

export const upsertUser = async ({ username, password, userId, isAdmin }) => {
  const id = userId || nanoid();
  const ref = usersCol().doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    const update = { username, isAdmin: !!isAdmin };
    if (password && password.length > 0) {
      update.password = await hasher.hash(password);
    }
    await ref.update(update);
  } else {
    await ref.set({
      username,
      password: await hasher.hash(password || ''),
      lastLogin: null,
      isAdmin: !!isAdmin,
      mcpToken: generateMcpToken(),
    });
  }
};

export const setLastLoginToNow = async ({ userId }) => {
  await usersCol().doc(userId).update({ lastLogin: Date.now() });
};

/** Remove a user and cascade jobs + listings (no FK cascades in Firestore). */
export const removeUser = async (userId) => {
  await removeJobsByUserId(userId);
  await usersCol().doc(userId).delete();
};

export const updatePasswordHash = async ({ userId, passwordHash }) => {
  await usersCol().doc(userId).update({ password: passwordHash });
};

export const ensureDemoUserExists = async () => {
  const settings = await getSettings();
  if (!settings.demoMode) {
    if (!inDevMode()) {
      const existing = await getUserWithSecretsByUsername(DEMO_USERNAME);
      if (existing) await removeUser(existing.id);
    }
    return;
  }
  const existing = await getUserWithSecretsByUsername(DEMO_USERNAME);
  if (!existing) {
    await usersCol()
      .doc(nanoid())
      .set({
        username: DEMO_USERNAME,
        password: await hasher.hash(DEMO_PASSWORD),
        lastLogin: null,
        isAdmin: false,
        mcpToken: generateMcpToken(),
      });
    return;
  }
  if (existing.isAdmin) {
    await usersCol().doc(existing.id).update({ isAdmin: false });
  }
};

export const validateMcpToken = async (token) => {
  if (!token) return null;
  const snapshot = await usersCol().where('mcpToken', '==', token).limit(1).get();
  return snapshot.empty ? null : { userId: snapshot.docs[0].id };
};

export const ensureAdminUserExists = async () => {
  const anySnapshot = await usersCol().limit(1).get();
  if (anySnapshot.empty) {
    await usersCol()
      .doc(nanoid())
      .set({
        username: ADMIN_USERNAME,
        password: await hasher.hash(DEFAULT_ADMIN_PASSWORD),
        lastLogin: Date.now(),
        isAdmin: true,
        mcpToken: generateMcpToken(),
      });
    return;
  }
  const adminSnapshot = await usersCol().where('isAdmin', '==', true).limit(1).get();
  if (adminSnapshot.empty) {
    const first = anySnapshot.docs[0];
    await usersCol().doc(first.id).update({ isAdmin: true });
  }
};
