/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createFirestoreMemory } from '../mocks/firestoreMemory.js';

const firestore = createFirestoreMemory();

vi.mock('../../lib/services/storage/firestore/FirestoreConnection.js', () => ({
  default: firestore.connection,
}));

vi.mock('../../lib/services/storage/settingsStorage.js', () => ({
  getSettings: async () => ({ demoMode: false }),
  upsertSettings: () => {},
}));

const USER = { id: 'u1', username: 'alice', isAdmin: false };

const provider = (id, applicationPolicy) => ({
  id,
  name: id,
  url: `https://${id}.example/search`,
  enabled: true,
  ...(applicationPolicy === undefined ? {} : { applicationPolicy }),
});

const buildApp = async () => {
  const plugin = (await import('../../lib/api/routes/jobRouter.js')).default;
  const app = Fastify();
  app.addHook('preHandler', async (request) => {
    request.currentUser = USER;
  });
  await app.register(plugin, { prefix: '/api/jobs' });
  return app;
};

describe('job provider application policy API', () => {
  let app;

  beforeEach(async () => {
    firestore.clear();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (payload) =>
    app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: {
        name: 'Applications',
        provider: [],
        notificationAdapter: [],
        ...payload,
      },
    });

  it('rejects an explicit automatic policy for a provider without automatic capability', async () => {
    const response = await post({ provider: [provider('immowelt', { automatic: 'enabled' })] });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not supported/i);
    expect(firestore.list('jobs')).toHaveLength(0);
  });

  it('accepts provider-scoped automatic policy and exposes it additively', async () => {
    const response = await post({ provider: [provider('immoscout', { automatic: 'enabled' })] });

    expect(response.statusCode).toBe(200);
    const row = firestore.list('jobs')[0];
    expect(row.provider).toEqual([
      {
        id: 'immoscout',
        name: 'immoscout',
        url: 'https://immoscout.example/search',
        enabled: true,
        applicationPolicy: { automatic: 'enabled' },
      },
    ]);
  });

  it.each([
    [true, 'enabled'],
    [false, 'disabled'],
  ])('normalizes boolean source policy %s to %s', async (automatic, expected) => {
    const response = await post({ provider: [provider('immoscout', { automatic })] });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0].applicationPolicy).toEqual({ automatic: expected });
  });

  it('keeps credentials and provider connections outside the job source document', async () => {
    const source = {
      ...provider('immoscout', { automatic: 'enabled', token: 'nested-secret' }),
      credentials: { password: 'must-not-persist' },
      connection: { accessToken: 'must-not-persist' },
      arbitrary: 'must-not-persist',
    };

    const response = await post({ provider: [source] });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider).toEqual([
      {
        id: 'immoscout',
        name: 'immoscout',
        url: 'https://immoscout.example/search',
        enabled: true,
        applicationPolicy: { automatic: 'enabled' },
      },
    ]);
  });

  it('accepts listing-scoped capability without claiming listing eligibility at storage time', async () => {
    const response = await post({ provider: [provider('inberlinwohnen', { automatic: 'enabled' })] });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0].applicationPolicy).toEqual({ automatic: 'enabled' });
  });

  it('lets a supplied legacy autoSendInquiry override source state during compatibility window', async () => {
    const response = await post({
      autoSendInquiry: true,
      provider: [provider('immoscout', { automatic: 'disabled' })],
    });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0].applicationPolicy).toEqual({ automatic: 'enabled' });
    expect(firestore.list('jobs')[0].autoSendInquiry).toBe(true);
  });

  it('uses source state when a future policy-only write omits legacy autoSendInquiry', async () => {
    const response = await post({
      provider: [provider('immoscout', { automatic: 'enabled' })],
    });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0].applicationPolicy).toEqual({ automatic: 'enabled' });
  });

  it('uses legacy autoSendInquiry when source policy is omitted', async () => {
    const response = await post({ autoSendInquiry: true, provider: [provider('immoscout')] });

    expect(response.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0].applicationPolicy).toEqual({ automatic: 'enabled' });
  });

  it('round-trips source policy updates without changing provider URL or enabled fields', async () => {
    const created = await post({ provider: [provider('immoscout', { automatic: 'enabled' })] });
    const jobId = firestore.list('jobs')[0].id;
    expect(created.statusCode).toBe(200);

    const updated = await post({
      jobId,
      provider: [provider('immoscout', { automatic: 'disabled' })],
    });

    expect(updated.statusCode).toBe(200);
    expect(firestore.list('jobs')[0].provider[0]).toMatchObject({
      id: 'immoscout',
      url: 'https://immoscout.example/search',
      enabled: true,
      applicationPolicy: { automatic: 'disabled' },
    });
  });
});
