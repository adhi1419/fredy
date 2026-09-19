/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createFirestoreMemory } from '../../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

const addListing = (id, jobId, isActive) =>
  firestore.seed('listings', id, {
    jobId,
    isActive: isActive === 1 ? true : isActive === 0 ? false : null,
    manuallyDeleted: false,
  });

const remainingIds = () => {
  const ids = [];
  for (const id of ['a', 'b', 'c', 'd']) {
    if (firestore.read('listings', id)) ids.push(id);
  }
  return ids;
};

describe('listingsStorage.deleteInactiveListingsByJobId', () => {
  let deleteInactiveListingsByJobId;

  beforeEach(async () => {
    firestore.clear();
    ({ deleteInactiveListingsByJobId } = await import('../../../lib/services/storage/listingsStorage.js'));
  });

  it('hard deletes only the inactive listings of the given job', async () => {
    addListing('a', 'demo-job', 0);
    addListing('b', 'demo-job', 1);
    addListing('c', 'demo-job', null);
    addListing('d', 'other-job', 0);

    await deleteInactiveListingsByJobId('demo-job');

    expect(remainingIds()).toEqual(['b', 'c', 'd']);
  });

  it('is a no-op without a job id', async () => {
    addListing('a', 'demo-job', 0);

    await deleteInactiveListingsByJobId(null);

    expect(remainingIds()).toEqual(['a']);
  });
});
