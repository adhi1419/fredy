/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/*
 * watchListStorage — Firestore implementation.
 * Composite doc id (listingId__userId) replaces UNIQUE(listing_id, user_id).
 */

import FirestoreConnection from './FirestoreConnection.js';
import { COLLECTIONS, watchDocId } from './collections.js';

const watchCol = () => FirestoreConnection.collection(COLLECTIONS.WATCH_LIST);

export const createWatch = async (listingId, userId) => {
  if (!listingId || !userId) return { created: false };
  try {
    await watchCol().doc(watchDocId(listingId, userId)).set({ listingId, userId });
    return { created: true };
  } catch {
    return { created: false };
  }
};

export const deleteWatch = async (listingId, userId) => {
  if (!listingId || !userId) return { deleted: false };
  const ref = watchCol().doc(watchDocId(listingId, userId));
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  await ref.delete();
  return { deleted: true };
};

export const ensureWatch = async (listingId, userId) => {
  if (!listingId || !userId) return { watched: false };
  const { created } = await createWatch(listingId, userId);
  if (created) return { watched: true };
  const snap = await watchCol().doc(watchDocId(listingId, userId)).get();
  return { watched: snap.exists };
};

export const toggleWatch = async (listingId, userId) => {
  if (!listingId || !userId) return { watched: false };
  const ref = watchCol().doc(watchDocId(listingId, userId));
  const snap = await ref.get();
  if (snap.exists) {
    await ref.delete();
    return { watched: false };
  }
  await ref.set({ listingId, userId });
  return { watched: true };
};
