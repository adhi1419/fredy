/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

const channels = new Map();
const jobs = new Map();
let nextChannelId = 1;
const sent = [];

const clone = (value) => (value == null ? value : structuredClone(value));
const channelStorageMock = {
  VISIBILITY: { PRIVATE: 'private', ADMIN: 'admin', EVERYONE: 'everyone' },
  normaliseVisibility: (value) =>
    ['private', 'admin', 'everyone'].includes(value) ? value : channelStorageMock.VISIBILITY.PRIVATE,
  getAllChannels: vi.fn(async () => [...channels.values()].map(clone)),
  getChannelsVisibleTo: vi.fn(async (user) => {
    if (user == null) return [];
    const isAdmin = user.isAdmin === true;
    const userId = user.id ?? null;
    return [...channels.values()]
      .filter((channel) => {
        if (userId != null && channel.userId === userId) return true;
        if (channel.visibility === 'everyone') return true;
        return channel.visibility === 'admin' && isAdmin;
      })
      .map(clone);
  }),
  getChannel: vi.fn(async (id) => clone(channels.get(id) ?? null)),
  upsertChannel: vi.fn(async ({ id, userId, adapterId, name, fields = {}, visibility }) => {
    const existing = id ? channels.get(id) : null;
    const channelId = existing?.id ?? id ?? `channel-${nextChannelId++}`;
    channels.set(channelId, {
      id: channelId,
      userId: existing?.userId ?? userId,
      adapterId: existing?.adapterId ?? adapterId,
      name,
      fields: clone(fields ?? {}),
      visibility: channelStorageMock.normaliseVisibility(visibility),
    });
    return channelId;
  }),
  removeChannel: vi.fn(async (id) => channels.delete(id)),
  getUsageCounts: vi.fn(async () => {
    const counts = new Map();
    for (const job of jobs.values()) {
      for (const ref of job.notificationAdapter ?? []) {
        if (ref?.configuredAdapterId) {
          counts.set(ref.configuredAdapterId, (counts.get(ref.configuredAdapterId) ?? 0) + 1);
        }
      }
    }
    return counts;
  }),
  getJobsUsingChannel: vi.fn(async (id) =>
    [...jobs.values()]
      .filter((job) => job.notificationAdapter?.some((ref) => ref?.configuredAdapterId === id))
      .map(({ id: jobId, name }) => ({ id: jobId, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  ),
};

vi.mock('../../lib/services/storage/configuredAdapterStorage.js', () => channelStorageMock);
vi.mock('../../lib/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getNotificationAdapters: async () => [
      {
        config: {
          id: 'telegram',
          name: 'Telegram',
          fields: {
            token: { type: 'text', label: 'Token', secret: true },
            chatId: { type: 'text', label: 'Chat Id', target: true },
          },
        },
        send: async (payload) => sent.push(payload),
      },
      {
        config: {
          id: 'slack',
          name: 'Slack',
          fields: { token: { type: 'text', secret: true }, channel: { type: 'text', target: true } },
        },
        send: async (payload) => sent.push(payload),
      },
    ],
  };
});

const ALICE = { id: 'u1', username: 'alice', isAdmin: false };
const BOB = { id: 'u2', username: 'bob', isAdmin: false };
const ADMIN = { id: 'a1', username: 'root', isAdmin: true };

describe('notificationChannelRouter', () => {
  let app;
  let storage;
  let currentUser;

  const build = async () => {
    const plugin = (await import('../../lib/api/routes/notificationChannelRouter.js')).default;
    const instance = Fastify();
    instance.addHook('preHandler', async (request) => {
      request.currentUser = currentUser;
      request.currentUser = currentUser;
    });
    await instance.register(plugin, { prefix: '/api/notificationChannels' });
    return instance;
  };

  beforeEach(async () => {
    channels.clear();
    jobs.clear();
    nextChannelId = 1;
    sent.length = 0;
    currentUser = ALICE;
    vi.clearAllMocks();
    storage = await import('../../lib/services/storage/configuredAdapterStorage.js');
    app = await build();
  });

  afterEach(async () => {
    await app.close();
  });

  const seed = async (over = {}) =>
    storage.upsertChannel({
      userId: 'u1',
      adapterId: 'telegram',
      name: 'Family',
      fields: { token: 'tok', chatId: '123' },
      visibility: 'private',
      ...over,
    });

  const get = (url) => app.inject({ method: 'GET', url });
  const post = (url, payload) => app.inject({ method: 'POST', url, payload });
  const del = (url) => app.inject({ method: 'DELETE', url });

  describe('GET /', () => {
    it('lists the channels the caller may use, with the destination', async () => {
      await seed();
      const body = (await get('/api/notificationChannels')).json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        adapterId: 'telegram',
        adapterName: 'Telegram',
        name: 'Family',
        destination: '123',
        visibility: 'private',
        usedByJobs: 0,
        canEdit: true,
        isOwner: true,
      });
    });

    it('never includes field values, not even for the owner', async () => {
      await seed();
      expect((await get('/api/notificationChannels')).json()[0].fields).toBeUndefined();
    });

    it('hides another user private channel', async () => {
      await seed();
      currentUser = BOB;
      expect((await get('/api/notificationChannels')).json()).toHaveLength(0);
    });

    it('shows an everyone channel to another user, but not as editable', async () => {
      await seed({ visibility: 'everyone' });
      currentUser = BOB;
      const body = (await get('/api/notificationChannels')).json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ canEdit: false, isOwner: false });
    });

    it('does not list another user private channel to an admin - admin status is not visibility', async () => {
      await seed(); // u1, private
      currentUser = ADMIN;
      expect((await get('/api/notificationChannels')).json()).toHaveLength(0);
    });

    it('lists an admin-visibility channel to an admin but not to an ordinary user', async () => {
      await seed({ visibility: 'admin' }); // owned by u1
      currentUser = BOB;
      expect((await get('/api/notificationChannels')).json()).toHaveLength(0);
      currentUser = ADMIN;
      const body = (await get('/api/notificationChannels')).json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ visibility: 'admin', canEdit: false, isOwner: false });
    });

    it('never leaks field values in the list, not even on a shared channel', async () => {
      await seed({ visibility: 'everyone' });
      currentUser = BOB;
      expect((await get('/api/notificationChannels')).json()[0].fields).toBeUndefined();
    });

    it('counts the jobs using a channel', async () => {
      const id = await seed();
      jobs.set('j1', { id: 'j1', name: 'Job 1', notificationAdapter: [{ configuredAdapterId: id }] });
      expect((await get('/api/notificationChannels')).json()[0].usedByJobs).toBe(1);
    });
  });

  describe('GET /:id', () => {
    it('reveals secrets to the owner so the editor can prefill', async () => {
      const id = await seed();
      expect((await get(`/api/notificationChannels/${id}`)).json().fields).toEqual({ token: 'tok', chatId: '123' });
    });

    it('is 403 for an admin on a private channel they do not own - admin status is not visibility', async () => {
      const id = await seed(); // owned by u1, private
      currentUser = ADMIN;
      expect((await get(`/api/notificationChannels/${id}`)).statusCode).toBe(403);
    });

    it('lets an admin read an admin-visibility channel but never reveals its secrets', async () => {
      const id = await seed({ visibility: 'admin' }); // owned by u1
      currentUser = ADMIN;
      const response = await get(`/api/notificationChannels/${id}`);
      expect(response.statusCode).toBe(200);
      // Summary is visible; the secret comes back blanked because the admin is not the owner.
      expect(response.json().fields).toEqual({ token: '', chatId: '123' });
    });

    it('blanks secrets for a non-owner who may only use the channel', async () => {
      const id = await seed({ visibility: 'everyone' });
      currentUser = BOB;
      expect((await get(`/api/notificationChannels/${id}`)).json().fields).toEqual({ token: '', chatId: '123' });
    });

    it('is 403 for a channel the caller cannot even see', async () => {
      const id = await seed();
      currentUser = BOB;
      expect((await get(`/api/notificationChannels/${id}`)).statusCode).toBe(403);
    });

    it('is 404 for an unknown id', async () => {
      expect((await get('/api/notificationChannels/nope')).statusCode).toBe(404);
    });
  });

  describe('POST /', () => {
    const payload = { adapterId: 'telegram', name: 'Work', fields: { token: 't', chatId: '9' } };

    it('creates a channel owned by the caller', async () => {
      const body = (await post('/api/notificationChannels', payload)).json();
      expect(await storage.getChannel(body.id)).toMatchObject({ userId: 'u1', adapterId: 'telegram', name: 'Work' });
    });

    it('forces a non-admin channel to private even when everyone is requested', async () => {
      const body = (await post('/api/notificationChannels', { ...payload, visibility: 'everyone' })).json();
      expect((await storage.getChannel(body.id)).visibility).toBe('private');
    });

    it('lets an admin set everyone', async () => {
      currentUser = ADMIN;
      const body = (await post('/api/notificationChannels', { ...payload, visibility: 'everyone' })).json();
      expect((await storage.getChannel(body.id)).visibility).toBe('everyone');
    });

    it('rejects a blank name', async () => {
      expect((await post('/api/notificationChannels', { ...payload, name: '  ' })).statusCode).toBe(400);
    });

    it('rejects an unknown adapter', async () => {
      expect((await post('/api/notificationChannels', { ...payload, adapterId: 'ghost' })).statusCode).toBe(400);
    });

    it('refuses to edit a channel the caller does not own', async () => {
      const id = await seed({ visibility: 'everyone' });
      currentUser = BOB;
      expect((await post('/api/notificationChannels', { id, name: 'Hijacked', fields: {} })).statusCode).toBe(403);
    });

    it('does not let administrator status edit another owner channel', async () => {
      const id = await seed({ visibility: 'admin' });
      currentUser = ADMIN;
      expect((await post('/api/notificationChannels', { id, name: 'Hijacked', fields: {} })).statusCode).toBe(403);
    });

    it('keeps the adapter type when updating', async () => {
      const id = await seed();
      await post('/api/notificationChannels', { id, adapterId: 'slack', name: 'Family', fields: {} });
      expect((await storage.getChannel(id)).adapterId).toBe('telegram');
    });

    it('preserves stored fields when the body omits the fields key', async () => {
      const id = await seed();
      const response = await post('/api/notificationChannels', { id, name: 'Renamed' });
      expect(response.statusCode).toBe(200);
      const saved = await storage.getChannel(id);
      expect(saved.name).toBe('Renamed');
      expect(saved.fields).toEqual({ token: 'tok', chatId: '123' });
    });

    it('replaces stored fields when the body carries the fields key', async () => {
      const id = await seed();
      await post('/api/notificationChannels', { id, name: 'Family', fields: { token: 'rotated', chatId: '123' } });
      expect((await storage.getChannel(id)).fields).toEqual({ token: 'rotated', chatId: '123' });
    });

    it('keeps an everyone channel everyone when its owner omits visibility', async () => {
      const id = await seed({ visibility: 'everyone' });
      await post('/api/notificationChannels', { id, name: 'Family', fields: { token: 'tok', chatId: '123' } });
      expect((await storage.getChannel(id)).visibility).toBe('everyone');
    });

    it('defaults a create with no fields and no visibility keys to {} and private', async () => {
      const body = (await post('/api/notificationChannels', { adapterId: 'telegram', name: 'Bare' })).json();
      const saved = await storage.getChannel(body.id);
      expect(saved.fields).toEqual({});
      expect(saved.visibility).toBe('private');
    });
  });

  describe('DELETE /:id', () => {
    it('deletes an unused channel', async () => {
      const id = await seed();
      expect((await del(`/api/notificationChannels/${id}`)).statusCode).toBe(200);
      expect(await storage.getChannel(id)).toBeNull();
    });

    it('refuses while jobs still reference it, and names them', async () => {
      const id = await seed();
      jobs.set('j1', { id: 'j1', name: 'Job 1', notificationAdapter: [{ configuredAdapterId: id }] });
      const response = await del(`/api/notificationChannels/${id}`);
      expect(response.statusCode).toBe(409);
      expect(response.json().jobs).toEqual([{ id: 'j1', name: 'Job 1' }]);
      expect(await storage.getChannel(id)).not.toBeNull();
    });

    it('refuses for a non-owner', async () => {
      const id = await seed({ visibility: 'everyone' });
      currentUser = BOB;
      expect((await del(`/api/notificationChannels/${id}`)).statusCode).toBe(403);
    });

    it('does not let administrator status delete another owner channel', async () => {
      const id = await seed({ visibility: 'admin' });
      currentUser = ADMIN;
      expect((await del(`/api/notificationChannels/${id}`)).statusCode).toBe(403);
    });
  });

  describe('POST /:id/try', () => {
    it('fires with the stored fields, which the client never saw', async () => {
      const id = await seed({ visibility: 'everyone' });
      currentUser = BOB;
      expect((await post(`/api/notificationChannels/${id}/try`, {})).statusCode).toBe(200);
      expect(sent[0].notificationConfig[0].fields).toEqual({ token: 'tok', chatId: '123' });
    });

    it('refuses for a channel the caller may not use', async () => {
      const id = await seed();
      currentUser = BOB;
      expect((await post(`/api/notificationChannels/${id}/try`, {})).statusCode).toBe(403);
    });
  });
});
