/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import FirestoreConnection from '../../lib/services/storage/firestore/FirestoreConnection.js';
import { runMigrations } from '../../scripts/migrations/run.js';

let stateDir;
let db;

beforeAll(async () => {
  await FirestoreConnection.init();
  db = FirestoreConnection.getConnection();
  stateDir = await fs.mkdtemp(path.join(process.env.KIROCREW_SCRATCH ?? os.tmpdir(), 'fredy-migrations-'));
});

beforeEach(async () => {
  await FirestoreConnection.clearAllData();
  await fs.rm(stateDir, { recursive: true, force: true });
});

afterAll(async () => {
  await FirestoreConnection.close();
});

async function dryRun(id) {
  const [result] = await runMigrations({ only: id, stateDir, db });
  expect(result.applied).toBe(false);
  return result.planHash;
}

async function apply(id, hash) {
  const [result] = await runMigrations({ only: id, apply: true, planHash: hash, stateDir, db });
  expect(result.applied).toBe(true);
  return result;
}

describe('Firestore migrations', () => {
  it('does not write during a dry run and applies 001 idempotently', async () => {
    await db.collection('listings').doc('rejected').set({
      inquirySendStatus: 'failed',
      inquirySendError: 'The listing does not contain an ImmoScout exposé id.',
    });
    const hash = await dryRun('001-inquiry-rejected');
    expect((await db.collection('listings').doc('rejected').get()).data().inquirySendStatus).toBe('failed');
    await apply('001-inquiry-rejected', hash);
    expect((await db.collection('listings').doc('rejected').get()).data().inquirySendStatus).toBe('rejected');
    const second = await runMigrations({ only: '001-inquiry-rejected', apply: true, planHash: hash, stateDir, db });
    expect(second[0].skipped).toBe(true);
  });

  it('backfills lifecycle and removes status in 002', async () => {
    await db
      .collection('listings')
      .doc('legacy')
      .set({ status: JSON.stringify({ status: 'applied', setAt: 7 }) });
    await apply('002-lifecycle-backfill', await dryRun('002-lifecycle-backfill'));
    const data = (await db.collection('listings').doc('legacy').get()).data();
    expect(data.lifecycle.state).toBe('applied');
    expect(data.status).toBeUndefined();
  });

  it('materializes source policies and removes autoSendInquiry in 003', async () => {
    await db
      .collection('jobs')
      .doc('job')
      .set({
        autoSendInquiry: false,
        provider: [{ id: 'immoscout', url: 'https://www.immobilienscout24.de' }],
      });
    await apply('003-application-policy', await dryRun('003-application-policy'));
    const data = (await db.collection('jobs').doc('job').get()).data();
    expect(data.autoSendInquiry).toBeUndefined();
    expect(data.provider[0].applicationPolicy).toEqual({ automatic: 'disabled' });
  });

  it('deletes sessions and obsolete user fields in 004', async () => {
    await db.collection('sessions').doc('session').set({ userId: 'u' });
    await db.collection('users').doc('user').set({ password: 'old', mcpToken: 'old', username: 'u' });
    await apply('004-dead-data', await dryRun('004-dead-data'));
    expect((await db.collection('sessions').doc('session').get()).exists).toBe(false);
    expect((await db.collection('users').doc('user').get()).data()).toEqual({ username: 'u' });
  });

  it('backfills missing optional values without overwriting existing values in 005', async () => {
    await db.collection('listings').doc('listing').set({ title: 'keep', price: 42, notificationComplete: true });
    await apply('005-explicit-nulls', await dryRun('005-explicit-nulls'));
    const data = (await db.collection('listings').doc('listing').get()).data();
    expect(data.title).toBe('keep');
    expect(data.price).toBe(42);
    expect(data.notificationComplete).toBe(true);
    expect(data.description).toBeNull();
    expect(data.activeCheckFailures).toBe(0);
    expect(data.travelTimeFailures).toBe(0);
  });
});
