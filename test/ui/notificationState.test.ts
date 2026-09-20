/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createNotificationEffects,
  createNotificationState,
  type NotificationStateSetter,
} from '../../ui/src/services/state/notificationState.js';

function setup() {
  const state = createNotificationState();
  const get = vi.fn();
  const post = vi.fn();
  const remove = vi.fn();
  const set: NotificationStateSetter = (updater) => Object.assign(state, updater(state));
  const effects = createNotificationEffects(set, { get, post, delete: remove });
  return { state, get, post, remove, effects };
}

describe('notification state domain', () => {
  it('starts with the exact notification state shapes', () => {
    expect(createNotificationState()).toEqual({
      notificationAdapter: [],
      notificationChannels: { channels: [], loaded: false },
    });
  });

  it('loads adapter metadata into a copied frozen list', async () => {
    const { state, get, effects } = setup();
    const adapters = [{ id: 'telegram', fields: { token: { secret: true } } }];
    get.mockResolvedValue({ status: 200, json: adapters });

    await expect(effects.notificationAdapter.getAdapter()).resolves.toBeUndefined();

    expect(get).toHaveBeenCalledWith('/api/jobs/notificationAdapter');
    expect(state.notificationAdapter).toEqual(adapters);
    expect(state.notificationAdapter).not.toBe(adapters);
    expect(Object.isFrozen(state.notificationAdapter)).toBe(true);
  });

  it('loads only the server channel summary into global state', async () => {
    const { state, get, effects } = setup();
    const summaries = [{ id: 'channel-1', name: 'Alerts', adapterId: 'telegram' }];
    get.mockResolvedValue({ status: 200, json: summaries });

    await effects.notificationChannels.getChannels();

    expect(get).toHaveBeenCalledWith('/api/notificationChannels');
    expect(state.notificationChannels).toEqual({ channels: summaries, loaded: true });
  });

  it('returns editable channel details without storing them globally', async () => {
    const { state, get, effects } = setup();
    const details = {
      id: 'channel-1',
      adapterId: 'telegram',
      fields: { token: 'editable-secret' },
    };
    get.mockResolvedValue({ status: 200, json: details });

    await expect(effects.notificationChannels.loadChannel('channel-1')).resolves.toBe(details);

    expect(get).toHaveBeenCalledWith('/api/notificationChannels/channel-1');
    expect(state.notificationChannels).toEqual({ channels: [], loaded: false });
  });

  it('preserves the draft test endpoint and payload', async () => {
    const { post, effects } = setup();
    post.mockResolvedValue({ status: 200, json: {} });
    const fields = { token: 'draft-secret', enabled: true };

    await expect(effects.notificationAdapter.tryDraft('telegram', fields)).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledWith('/api/jobs/notificationAdapter/try', {
      id: 'telegram',
      fields,
    });
  });

  it('saves, refreshes channels locally, and returns the saved response', async () => {
    const { state, get, post, effects } = setup();
    const payload = {
      id: 'channel-1',
      adapterId: 'telegram',
      name: 'Alerts',
      fields: { token: 'secret' },
      visibility: 'private',
    };
    const saved = { id: 'channel-1', name: 'Alerts', adapterId: 'telegram' };
    const refreshed = [saved];
    post.mockResolvedValue({ status: 200, json: saved });
    get.mockResolvedValue({ status: 200, json: refreshed });

    await expect(effects.notificationChannels.saveChannel(payload)).resolves.toBe(saved);

    expect(post).toHaveBeenCalledWith('/api/notificationChannels', payload);
    expect(get).toHaveBeenCalledWith('/api/notificationChannels');
    expect(state.notificationChannels).toEqual({ channels: refreshed, loaded: true });
  });

  it('removes, refreshes channels locally, and preserves the delete route', async () => {
    const { state, get, remove, effects } = setup();
    const refreshed = [{ id: 'remaining', name: 'Remaining' }];
    remove.mockResolvedValue({ status: 204, json: null });
    get.mockResolvedValue({ status: 200, json: refreshed });

    await expect(effects.notificationChannels.removeChannel('channel-1')).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith('/api/notificationChannels/channel-1');
    expect(get).toHaveBeenCalledWith('/api/notificationChannels');
    expect(state.notificationChannels).toEqual({ channels: refreshed, loaded: true });
  });

  it('preserves the saved-channel test endpoint and empty payload', async () => {
    const { post, effects } = setup();
    post.mockResolvedValue({ status: 200, json: {} });

    await expect(effects.notificationChannels.tryChannel('channel-1')).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledWith('/api/notificationChannels/channel-1/try', {});
  });

  it('keeps list-load errors out of state while preserving the existing log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { state, get, effects } = setup();
    const failure = new Error('offline');
    get.mockRejectedValue(failure);

    await expect(effects.notificationChannels.getChannels()).resolves.toBeUndefined();

    expect(state.notificationChannels).toEqual({ channels: [], loaded: false });
    expect(consoleError).toHaveBeenCalledWith(
      'Error while trying to get resource for api/notificationChannels. Error:',
      failure,
    );
    consoleError.mockRestore();
  });
});
