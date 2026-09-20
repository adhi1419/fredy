/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * configuredAdapterStorage — Firestore implementation.
 */

import { nanoid } from 'nanoid';
import { canListChannel } from '../../security/channelAccess.js';
import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS } from './collections.js';

export const VISIBILITY = Object.freeze({ PRIVATE: 'private', ADMIN: 'admin', EVERYONE: 'everyone' });
const VISIBILITIES = new Set(Object.values(VISIBILITY));
export const normaliseVisibility = (value) => (VISIBILITIES.has(value) ? value : VISIBILITY.PRIVATE);

const channelsCol = () => FirestoreConnection.collection(COLLECTIONS.CHANNELS);
const jobsCol = () => FirestoreConnection.collection(COLLECTIONS.JOBS);

const mapDoc = (snap) => {
  const d = snap.data();
  return {
    id: snap.id,
    userId: d.userId,
    adapterId: d.adapterId,
    name: d.name,
    fields: d.fields ?? {},
    visibility: d.visibility,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
};

export const getAllChannels = async () => {
  const snapshot = await channelsCol().orderBy('name').get();
  return snapshot.docs.map(mapDoc);
};

/**
 * Channels a specific user may see in the notification-channel manager.
 *
 * This is the user-scoped read seam for the product surface: the owner's own channels, plus the
 * `everyone` share, plus the admin-targeted `admin` share when the caller is an admin. Admin status
 * alone never widens this — it mirrors {@link import('../../security/channelAccess.js').canListChannel}
 * so the query and the predicate cannot drift.
 *
 * {@link getAllChannels} is deliberately left unscoped: job hydration and the scheduler resolve
 * channel references across every tenant and must keep seeing all channels. Isolation belongs on
 * the product read path, not on internal execution.
 *
 * @param {{id?: string, isAdmin?: boolean}|null|undefined} user
 * @returns {Promise<Array<ReturnType<typeof mapDoc>>>} Name-ordered channels visible to the user.
 */
export const getChannelsVisibleTo = async (user) => {
  if (user == null) return [];
  return (await getAllChannels()).filter((channel) => canListChannel(user, channel));
};

export const getChannel = async (id) => {
  if (!id || typeof id !== 'string') return null;
  const snap = await channelsCol().doc(id).get();
  return snap.exists ? mapDoc(snap) : null;
};

export const upsertChannel = async ({ id, userId, adapterId, name, fields = {}, visibility }) => {
  const now = Date.now();
  const existing = id ? await getChannel(id) : null;

  if (existing) {
    await channelsCol()
      .doc(existing.id)
      .update({ name, fields: fields ?? {}, visibility: normaliseVisibility(visibility), updatedAt: now });
    return existing.id;
  }

  const newId = id || nanoid();
  await channelsCol()
    .doc(newId)
    .set({
      userId,
      adapterId,
      name,
      fields: fields ?? {},
      visibility: normaliseVisibility(visibility),
      createdAt: now,
      updatedAt: now,
    });
  return newId;
};

export const removeChannel = async (id) => {
  await channelsCol().doc(id).delete();
};

/**
 * Find jobs referencing a channel by filtering each job's native array of
 * notification-channel references in memory.
 */
export const getJobsUsingChannel = async (id) => {
  const snapshot = await jobsCol().get();
  return snapshot.docs
    .filter((doc) => {
      const refs = doc.data().notificationAdapter;
      return (
        Array.isArray(refs) && refs.some((ref) => ref && typeof ref === 'object' && ref.configuredAdapterId === id)
      );
    })
    .map((doc) => ({ id: doc.id, name: doc.data().name ?? null }))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
};

export const getUsageCounts = async () => {
  const snapshot = await jobsCol().get();
  const counts = new Map();
  for (const doc of snapshot.docs) {
    const refs = doc.data().notificationAdapter;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      const channelId = ref && typeof ref === 'object' ? ref.configuredAdapterId : null;
      if (channelId != null) counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
    }
  }
  return counts;
};
