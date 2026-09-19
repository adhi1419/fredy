/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Firestore implementation of Firebase-derived Fredy users. */

import { nanoid } from 'nanoid';
import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS } from './collections.js';
import { getSettings } from './settingsStorage.js';
import { removeJobsByUserId } from './jobStorage.js';
import { inDevMode } from '../../../utils.js';

export const DEMO_USERNAME = 'demo';

const usersCol = () => FirestoreConnection.collection(COLLECTIONS.USERS);
const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);

async function jobsCountFor(userId) {
  const agg = await jobsCol().where('userId', '==', userId).count().get();
  return agg.data().count;
}

function identityOf(id, data) {
  return {
    id,
    username: data.username,
    lastLogin: data.lastLogin ?? null,
    isAdmin: data.isAdmin === true,
  };
}

/** All provisioned users, credentials excluded, ordered by email. */
export const getUsers = async () => {
  const snapshot = await usersCol().orderBy('username').get();
  return Promise.all(
    snapshot.docs.map(async (doc) => ({
      ...identityOf(doc.id, doc.data()),
      numberOfJobs: await jobsCountFor(doc.id),
    })),
  );
};

/** Lightweight identity lookup for the per-request authentication path. */
export const getUserIdentity = async (id) => {
  if (!id || typeof id !== 'string') return null;
  const snap = await usersCol().doc(id).get();
  return snap.exists ? identityOf(snap.id, snap.data()) : null;
};

export const getUser = async (id) => {
  const user = await getUserIdentity(id);
  return user == null ? null : { ...user, numberOfJobs: await jobsCountFor(id) };
};

export const getUserByUsername = async (username) => {
  if (!username || typeof username !== 'string') return null;
  const snapshot = await usersCol().where('username', '==', username).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return identityOf(doc.id, doc.data());
};

/** Provision or synchronize a Firebase UID projection. */
export const upsertUser = async ({ username, userId, isAdmin }) => {
  const id = userId || nanoid();
  const ref = usersCol().doc(id);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ username, isAdmin: isAdmin === true });
  } else {
    await ref.set({ username, lastLogin: null, isAdmin: isAdmin === true });
  }
  return id;
};

export const setLastLoginToNow = async ({ userId }) => {
  await usersCol().doc(userId).update({ lastLogin: Date.now() });
};

/** Remove a user and cascade their jobs and listings. */
export const removeUser = async (userId) => {
  await removeJobsByUserId(userId);
  await usersCol().doc(userId).delete();
};

/** Maintain the non-login demo owner used only by demo-mode seeded data. */
export const ensureDemoUserExists = async () => {
  const settings = await getSettings();
  if (!settings.demoMode) {
    if (!inDevMode()) {
      const existing = await getUserByUsername(DEMO_USERNAME);
      if (existing) await removeUser(existing.id);
    }
    return;
  }

  const existing = await getUserByUsername(DEMO_USERNAME);
  if (!existing) {
    await usersCol().doc(nanoid()).set({ username: DEMO_USERNAME, lastLogin: null, isAdmin: false });
  } else if (existing.isAdmin) {
    await usersCol().doc(existing.id).update({ isAdmin: false });
  }
};
