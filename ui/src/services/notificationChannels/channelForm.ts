/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The channel editor's state, kept out of the component so it can be tested without rendering.
 */
export interface ChannelDraft {
  /** null for create and for clone. */
  id: string | null;
  adapterId: string;
  name: string;
  fields: Record<string, unknown>;
  visibility: string;
}

/** One declared field on an adapter's config. */
interface FieldDefinition {
  type?: string;
  secret?: boolean;
  optional?: boolean;
  // Adapter field definitions also carry presentation keys (label, help, ...) this module ignores.
  [key: string]: unknown;
}

interface AdapterConfig {
  id: string;
  fields?: Record<string, FieldDefinition>;
}

type Translate = (key: string) => string;

/**
 * A blank draft for one adapter type.
 *
 * Every declared field is seeded, so the form is controlled from the first render and a boolean
 * never starts as `undefined`.
 */
export function emptyChannel(adapterConfig: AdapterConfig): ChannelDraft {
  const fields: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(adapterConfig?.fields ?? {})) {
    fields[key] = definition?.type === 'boolean' ? false : '';
  }
  return { id: null, adapterId: adapterConfig.id, name: '', fields, visibility: 'private' };
}

/**
 * Turn a loaded channel into a draft for a new copy of it.
 *
 * The copy always belongs to whoever made it and always starts private: cloning is how a user gets
 * their own variant of somebody else's channel, and inheriting `everyone` would re-share it on
 * their behalf. Secrets only come along when the server was willing to reveal them, which is the
 * same rule the editor uses.
 */
export function toCloneDraft(
  channel: { adapterId: string; name: string; fields?: Record<string, unknown> },
  { canRevealSecrets, adapterConfig }: { canRevealSecrets: boolean; adapterConfig: AdapterConfig },
): ChannelDraft {
  const fields: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(adapterConfig?.fields ?? {})) {
    if (definition?.secret === true && !canRevealSecrets) {
      fields[key] = '';
      continue;
    }
    fields[key] = channel.fields?.[key] ?? (definition?.type === 'boolean' ? false : '');
  }
  return {
    id: null,
    adapterId: channel.adapterId,
    name: `${channel.name} (copy)`,
    fields,
    visibility: 'private',
  };
}

/**
 * Validate a draft. Returns translated messages, de-duplicated, in a stable order.
 *
 * Takes only the parts of a draft it reads - the name and the field values - so a caller can
 * validate a work-in-progress draft that has not yet been given an id, adapter, or visibility.
 */
export function validateChannel(
  draft: { name?: unknown; fields?: Record<string, unknown> },
  adapterConfig: AdapterConfig,
  t: Translate,
): string[] {
  const messages: string[] = [];
  if (typeof draft?.name !== 'string' || draft.name.trim().length === 0) {
    messages.push(t('notification.channels.validationName'));
  }

  for (const [key, definition] of Object.entries(adapterConfig?.fields ?? {})) {
    const value = draft?.fields?.[key];
    if (definition?.type === 'boolean') continue;

    if (definition?.type === 'number' && value !== '' && value != null) {
      const parsed = parseFloat(String(value));
      if (Number.isNaN(parsed) || parsed < 0) {
        messages.push(t('notification.validationNumberField'));
        continue;
      }
    }
    if (definition?.optional === true) continue;
    if (value == null || String(value).trim().length === 0) {
      messages.push(t('notification.validationAllMandatory'));
    }
  }

  return [...new Set(messages)];
}

/**
 * Shape a draft for `POST /api/notificationChannels`.
 *
 * `fields` and `visibility` are always sent. The route treats an absent key as "keep what is
 * stored", so omitting them here would make an edit silently no-op instead of applying.
 */
export function toPayload(draft: ChannelDraft): {
  id: string | null;
  adapterId: string;
  name: string;
  fields: Record<string, unknown>;
  visibility: string;
} {
  return {
    id: draft.id,
    adapterId: draft.adapterId,
    name: draft.name.trim(),
    fields: { ...draft.fields },
    visibility: draft.visibility,
  };
}
