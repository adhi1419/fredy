/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it } from 'vitest';
import {
  currentFirestoreUsage,
  recordFirestoreRead,
  recordFirestoreWrite,
  withFirestoreUsageScope,
} from '../../../lib/services/storage/firestore/firestoreUsage.js';

describe('Firestore usage scopes', () => {
  it('accounts reads and writes within the async scope', async () => {
    let observed;
    await withFirestoreUsageScope('listing-reconcile', async () => {
      recordFirestoreRead(3);
      recordFirestoreWrite();
      observed = currentFirestoreUsage();
    });

    expect(observed).toEqual({ name: 'listing-reconcile', reads: 3, writes: 1 });
    expect(currentFirestoreUsage()).toBeNull();
  });

  it('keeps nested scopes isolated and restores the parent', async () => {
    await withFirestoreUsageScope('parent', async () => {
      recordFirestoreRead();
      await withFirestoreUsageScope('child', async () => {
        recordFirestoreWrite(2);
        expect(currentFirestoreUsage()).toMatchObject({ name: 'child', reads: 0, writes: 2 });
      });
      expect(currentFirestoreUsage()).toMatchObject({ name: 'parent', reads: 1, writes: 0 });
    });
  });
});
