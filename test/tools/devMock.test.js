/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDevMockServer } from '../../tools/devMock.js';

let server;
let baseUrl;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return { response, body: await response.json() };
}

beforeEach(async () => {
  server = createDevMockServer({ port: 0 });
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('dev mock Saved Search contract', () => {
  it('returns owned active, paused, running, and shared read-only jobs', async () => {
    const { response, body } = await request('/api/jobs/table');

    expect(response.status).toBe(200);
    expect(body.result).toHaveLength(4);
    expect(body.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'job1', enabled: true, running: false, isOnlyShared: false }),
        expect.objectContaining({ id: 'job2', enabled: false, running: false, isOnlyShared: false }),
        expect.objectContaining({ id: 'job3', enabled: true, running: true, isOnlyShared: false }),
        expect.objectContaining({ id: 'job4', enabled: true, running: false, isOnlyShared: true }),
      ]),
    );
  });

  it('persists pause and resume mutations in subsequent job reads', async () => {
    const paused = await request('/api/jobs/job2/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: true }),
    });
    expect(paused.response.status).toBe(200);
    expect(paused.body.enabled).toBe(true);

    const resumed = await request('/api/jobs/table');
    expect(resumed.body.result.find((job) => job.id === 'job2').enabled).toBe(true);

    const pausedAgain = await request('/api/jobs/job2/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: false }),
    });
    expect(pausedAgain.response.status).toBe(200);

    const finalRead = await request('/api/jobs/table');
    expect(finalRead.body.result.find((job) => job.id === 'job2').enabled).toBe(false);
  });

  it('persists a run mutation as running in subsequent job reads', async () => {
    const run = await request('/api/jobs/job1/run', { method: 'POST' });
    expect(run.response.status).toBe(202);
    expect(run.body.running).toBe(true);

    const read = await request('/api/jobs/data?page=1');
    expect(read.body.result.find((job) => job.id === 'job1').running).toBe(true);

    const secondRun = await request('/api/jobs/job1/run', { method: 'POST' });
    expect(secondRun.response.status).toBe(409);
  });

  it('returns iterable channels and adapter metadata', async () => {
    const channels = await request('/api/notificationChannels');
    const adapters = await request('/api/jobs/notificationAdapter');

    expect(channels.response.status).toBe(200);
    expect(Array.isArray(channels.body)).toBe(true);
    expect(channels.body[0]).toEqual(expect.objectContaining({ id: 'channel-1' }));
    expect(adapters.response.status).toBe(200);
    expect(adapters.body).toEqual([
      expect.objectContaining({ id: 'browser', name: 'Browser Notifications', config: {} }),
    ]);
    expect(adapters.body.map((adapter) => adapter.id)).not.toContain('immoscout');
  });

  it('returns usable provider metadata while preserving available listing providers', async () => {
    const providers = await request('/api/jobs/provider');
    const listings = await request('/api/listings/table');

    expect(providers.response.status).toBe(200);
    expect(providers.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'immoscout',
          baseUrl: expect.stringContaining('immobilienscout24'),
          countries: ['de'],
          capabilities: { application: expect.objectContaining({ automatic: true, eligibility: 'provider' }) },
        }),
        expect.objectContaining({ id: 'metadataOnly', baseUrl: 'https://example.com/metadata-only' }),
      ]),
    );
    expect(listings.body.availableProviders).toEqual(['immoscout', 'immo']);
    expect(listings.body.availableProviders).not.toContain('metadataOnly');
  });

  it('rejects mutations for the explicit shared read-only job', async () => {
    const status = await request('/api/jobs/job4/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: false }),
    });
    const run = await request('/api/jobs/job4/run', { method: 'POST' });

    expect(status.response.status).toBe(403);
    expect(run.response.status).toBe(403);
    const read = await request('/api/jobs/table');
    expect(read.body.result.find((job) => job.id === 'job4')).toMatchObject({ enabled: true, isOnlyShared: true });
  });
});
