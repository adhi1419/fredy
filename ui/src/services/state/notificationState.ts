/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The notification adapter metadata and saved-channel domain state used by the aggregate Zustand
 * store.
 *
 * Channel details are deliberately returned only to the direct caller. The list endpoint remains
 * the only source written into global state, so editable credentials cannot leak into the store.
 */

export interface NotificationAdapter {
  [key: string]: unknown;
}

export interface NotificationChannelSummary {
  [key: string]: unknown;
}

export interface NotificationChannelDetails {
  [key: string]: unknown;
}

export interface NotificationChannelsState {
  channels: readonly NotificationChannelSummary[];
  loaded: boolean;
}

export interface NotificationState {
  notificationAdapter: readonly NotificationAdapter[];
  notificationChannels: NotificationChannelsState;
}

export interface NotificationRootState {
  notificationAdapter: readonly NotificationAdapter[];
  notificationChannels: NotificationChannelsState;
}

export interface NotificationResponse<T> {
  status: number;
  json: T;
}

export interface NotificationTransport {
  get<T>(url: string): Promise<NotificationResponse<T>>;
  post<T>(url: string, data: unknown): Promise<NotificationResponse<T>>;
  delete<T>(url: string): Promise<NotificationResponse<T>>;
}

export interface NotificationStateSetter {
  (updater: (state: NotificationRootState) => Partial<NotificationRootState>): void;
}

export interface NotificationAdapterEffects {
  getAdapter(): Promise<void>;
  tryDraft(adapterId: string, fields: Record<string, unknown>): Promise<void>;
}

export interface NotificationChannelEffects {
  getChannels(): Promise<void>;
  loadChannel(channelId: string): Promise<NotificationChannelDetails>;
  saveChannel(payload: Record<string, unknown>): Promise<NotificationChannelDetails>;
  removeChannel(channelId: string): Promise<void>;
  tryChannel(channelId: string): Promise<void>;
}

export interface NotificationEffects {
  notificationAdapter: NotificationAdapterEffects;
  notificationChannels: NotificationChannelEffects;
}

export function createNotificationState(): NotificationState {
  return {
    notificationAdapter: [],
    notificationChannels: { channels: [], loaded: false },
  };
}

export function createNotificationEffects(
  set: NotificationStateSetter,
  transport: NotificationTransport,
): NotificationEffects {
  async function getChannels(): Promise<void> {
    try {
      const response = await transport.get<readonly NotificationChannelSummary[]>('/api/notificationChannels');
      set(() => ({
        notificationChannels: { channels: [...response.json], loaded: true },
      }));
    } catch (exception) {
      console.error('Error while trying to get resource for api/notificationChannels. Error:', exception);
    }
  }

  const notificationAdapter: NotificationAdapterEffects = {
    async getAdapter(): Promise<void> {
      try {
        const response = await transport.get<readonly NotificationAdapter[]>('/api/jobs/notificationAdapter');
        set(() => ({ notificationAdapter: Object.freeze([...response.json]) }));
      } catch (exception) {
        console.error(`Error while trying to get resource for api/jobs/notificationAdapter. Error:`, exception);
      }
    },

    /** Test-fire a draft that has not been saved yet. */
    async tryDraft(adapterId, fields): Promise<void> {
      await transport.post('/api/jobs/notificationAdapter/try', { id: adapterId, fields });
    },
  };

  const notificationChannels: NotificationChannelEffects = {
    getChannels,

    /** Load one channel including its field values for the direct editor caller only. */
    async loadChannel(channelId): Promise<NotificationChannelDetails> {
      const response = await transport.get<NotificationChannelDetails>(`/api/notificationChannels/${channelId}`);
      return response.json;
    },

    async saveChannel(payload): Promise<NotificationChannelDetails> {
      const response = await transport.post<NotificationChannelDetails>('/api/notificationChannels', payload);
      await getChannels();
      return response.json;
    },

    async removeChannel(channelId): Promise<void> {
      await transport.delete(`/api/notificationChannels/${channelId}`);
      await getChannels();
    },

    async tryChannel(channelId): Promise<void> {
      await transport.post(`/api/notificationChannels/${channelId}/try`, {});
    },
  };

  return { notificationAdapter, notificationChannels };
}
