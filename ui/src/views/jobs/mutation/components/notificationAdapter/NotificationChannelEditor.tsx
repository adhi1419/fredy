/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Banner, Button, Input, Modal, Select, Switch, Toast } from '@douyinfe/semi-ui-19';

import Help from './NotificationHelpDisplay';
import { useActions, useSelector } from '../../../../../services/state/store';
import type {
  NotificationAdapter,
  NotificationAdapterEffects,
  NotificationChannelEffects,
} from '../../../../../services/state/notificationState.js';
import { errorMessage } from '../../../../../services/xhr';
import { triggerTestNotification } from '../../../../../services/notification/browserNotification';
import { useScreenWidth } from '../../../../../hooks/screenWidth.js';
import { useTranslation } from '../../../../../services/i18n/i18n.jsx';
import {
  emptyChannel,
  toCloneDraft,
  toPayload,
  validateChannel,
} from '../../../../../services/notificationChannels/channelForm.js';
import type { ChannelDraft } from '../../../../../services/notificationChannels/channelForm.js';

import './NotificationChannelEditor.less';

/** One declared field on an adapter's config, as the editor renders it. */
interface FieldDefinition {
  type?: string;
  secret?: boolean;
  label?: string;
  description?: string;
  [key: string]: unknown;
}

/** An adapter's config as this editor reads it. */
interface AdapterConfig {
  id: string;
  name?: string;
  description?: string;
  readme?: string | null;
  fields?: Record<string, FieldDefinition>;
}

/** A saved channel loaded for edit or clone. */
interface LoadedChannel {
  id: string;
  adapterId: string;
  name: string;
  fields?: Record<string, unknown>;
  visibility: string;
  canEdit?: boolean;
  usedByJobs?: number;
}

/** The current viewer, only their admin flag matters here. */
interface CurrentUser {
  isAdmin?: boolean;
}

/** The store slices this editor reads. */
interface ChannelEditorState {
  notificationAdapter: readonly NotificationAdapter[];
  user: { currentUser: CurrentUser | null };
}

/** The effects this editor dispatches. */
interface ChannelEditorActions {
  notificationChannels: NotificationChannelEffects;
  notificationAdapter: NotificationAdapterEffects;
}

/** Read a string property off a loosely-typed record. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Narrow one loosely-typed store adapter into the config shape this editor renders. */
function asAdapterConfig(value: unknown): AdapterConfig | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = readString(record, 'id');
  if (id == null) return null;
  return {
    id,
    name: readString(record, 'name'),
    description: readString(record, 'description'),
    readme: readString(record, 'readme') ?? null,
    fields:
      record.fields != null && typeof record.fields === 'object'
        ? (record.fields as Record<string, FieldDefinition>)
        : undefined,
  };
}

/** Find the adapter config matching an id among the loosely-typed store adapters. */
function findAdapterConfig(
  adapters: readonly NotificationAdapter[],
  id: string | null | undefined,
): AdapterConfig | null {
  if (id == null) return null;
  for (const adapter of adapters) {
    const config = asAdapterConfig(adapter);
    if (config?.id === id) return config;
  }
  return null;
}

/** Narrow the loosely-typed loadChannel response into the channel shape the editor needs. */
function asLoadedChannel(value: unknown): LoadedChannel | null {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = readString(record, 'id');
  const adapterId = readString(record, 'adapterId');
  const name = readString(record, 'name');
  const visibility = readString(record, 'visibility');
  if (id == null || adapterId == null || name == null || visibility == null) return null;
  return {
    id,
    adapterId,
    name,
    visibility,
    fields:
      record.fields != null && typeof record.fields === 'object'
        ? (record.fields as Record<string, unknown>)
        : undefined,
    canEdit: typeof record.canEdit === 'boolean' ? record.canEdit : undefined,
    usedByJobs: typeof record.usedByJobs === 'number' ? record.usedByJobs : undefined,
  };
}

interface NotificationChannelEditorProps {
  visible: boolean;
  mode: 'create' | 'edit' | 'clone';
  /** Required for edit and clone. */
  channelId?: string | null;
  /** Required for create. */
  adapterId?: string | null;
  /** Job count at which the shared-channel banner appears. */
  warnUsageAbove?: number;
  onClose: () => void;
  onSaved?: (channel: { id: string; [key: string]: unknown }) => void;
}

/**
 * Create, edit or duplicate one notification channel.
 *
 * One component for all three because they are the same form over the same fields; only where the
 * initial draft comes from differs. Three components would mean three copies of the field renderer
 * and three chances for the validation to drift apart.
 *
 * `warnUsageAbove` exists because "shared" means something different depending on where the editor
 * was opened. From the Settings page a channel is shared once a second job uses it. From inside a
 * job, even one *other* job matters, because the person editing is thinking about this job alone
 * and would not expect to change somebody else's.
 */
export default function NotificationChannelEditor({
  visible,
  mode,
  channelId = null,
  adapterId = null,
  warnUsageAbove = 2,
  onClose,
  onSaved,
}: NotificationChannelEditorProps): ReactElement | null {
  const t = useTranslation();
  const actions = useActions<ChannelEditorActions>();
  const adapters = useSelector<ChannelEditorState, readonly NotificationAdapter[]>(
    (state) => state.notificationAdapter,
  );
  const currentUser = useSelector<ChannelEditorState, CurrentUser | null>((state) => state.user.currentUser);
  const width = useScreenWidth();
  const isMobile = width <= 850;

  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [loaded, setLoaded] = useState<LoadedChannel | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [secretsHidden, setSecretsHidden] = useState(false);
  const [saving, setSaving] = useState(false);

  const adapterConfig = findAdapterConfig(adapters, draft?.adapterId ?? adapterId);

  useEffect(() => {
    if (!visible) {
      setDraft(null);
      setLoaded(null);
      setValidationMessage(null);
      setSuccessMessage(null);
      setSecretsHidden(false);
      return undefined;
    }

    if (mode === 'create') {
      const config = findAdapterConfig(adapters, adapterId);
      if (config) setDraft(emptyChannel(config));
      return undefined;
    }

    if (channelId == null) return undefined;

    let cancelled = false;
    actions.notificationChannels
      .loadChannel(channelId)
      .then((channel) => {
        if (cancelled) return;
        const loadedChannel = asLoadedChannel(channel);
        if (loadedChannel == null) return;
        const config = findAdapterConfig(adapters, loadedChannel.adapterId);
        setLoaded(loadedChannel);
        if (mode === 'clone') {
          // The server already blanked whatever it would not reveal; `canEdit` says which case
          // this was, and therefore whether to tell the user their own credentials are needed.
          setSecretsHidden(!loadedChannel.canEdit);
          if (config) {
            setDraft(
              toCloneDraft(loadedChannel, { canRevealSecrets: loadedChannel.canEdit === true, adapterConfig: config }),
            );
          }
        } else {
          setDraft({
            id: loadedChannel.id,
            adapterId: loadedChannel.adapterId,
            name: loadedChannel.name,
            fields: { ...loadedChannel.fields },
            visibility: loadedChannel.visibility,
          });
        }
      })
      .catch((error) => Toast.error(errorMessage(error, t('common.unknownError'))));

    return () => {
      cancelled = true;
    };
  }, [visible, mode, channelId, adapterId, adapters, actions, t]);

  if (!visible || draft == null || adapterConfig == null) return null;

  const setField = (key: string, value: unknown) => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } });

  const save = async () => {
    const problems = validateChannel(draft, adapterConfig, t);
    if (problems.length > 0) {
      setValidationMessage(problems.join('<br/>'));
      return;
    }
    setSaving(true);
    try {
      const saved = await actions.notificationChannels.saveChannel(toPayload(draft));
      Toast.success(t('notification.channels.saved'));
      const savedId = typeof saved.id === 'string' ? saved.id : draft.id;
      if (savedId != null) onSaved?.({ ...saved, id: savedId });
      onClose();
    } catch (error) {
      setValidationMessage(errorMessage(error, t('common.unknownError')));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setValidationMessage(null);
    setSuccessMessage(null);

    const problems = validateChannel(draft, adapterConfig, t);
    if (problems.length > 0) {
      setValidationMessage(problems.join('<br/>'));
      return;
    }
    if (draft.adapterId === 'browser') {
      triggerTestNotification(t, setSuccessMessage, setValidationMessage);
      return;
    }
    try {
      // The draft route, not the stored-channel one: an unsaved draft has no id, and an edited
      // draft should be tested as it stands rather than as it was last saved.
      await actions.notificationAdapter.tryDraft(draft.adapterId, draft.fields);
      setSuccessMessage(t('notification.trySuccess'));
    } catch (error) {
      setValidationMessage(t('notification.tryError', { error: errorMessage(error, t('common.unknownError')) }));
    }
  };

  const showSharedWarning = mode === 'edit' && (loaded?.usedByJobs ?? 0) >= warnUsageAbove;

  const title = {
    create: t('notification.channels.createTitle'),
    edit: t('notification.channels.editTitle'),
    clone: t('notification.channels.cloneTitle'),
  }[mode];

  return (
    <Modal
      title={title}
      visible={visible}
      style={{ width: isMobile ? '95%' : '50rem' }}
      onCancel={onClose}
      footer={
        <div>
          <Button type="secondary" style={{ float: 'left' }} onClick={test}>
            {t('notification.try')}
          </Button>
          <Button theme="light" type="tertiary" onClick={onClose}>
            {t('notification.cancel')}
          </Button>
          <Button theme="solid" type="primary" loading={saving} onClick={save}>
            {t('notification.save')}
          </Button>
        </div>
      }
    >
      {showSharedWarning && (
        <Banner
          fullMode={false}
          type="warning"
          closeIcon={null}
          className="channelEditor__banner"
          description={t('notification.channels.sharedWarning', { count: loaded?.usedByJobs ?? 0 })}
        />
      )}

      {secretsHidden && (
        <Banner
          fullMode={false}
          type="info"
          closeIcon={null}
          className="channelEditor__banner"
          description={t('notification.channels.cloneSecretsHidden')}
        />
      )}

      {validationMessage != null && (
        <Banner
          fullMode={false}
          type="danger"
          closeIcon={null}
          className="channelEditor__banner"
          title={<div className="channelEditor__bannerTitle">{t('notification.errorTitle')}</div>}
          description={<p dangerouslySetInnerHTML={{ __html: validationMessage }} />}
        />
      )}
      {successMessage != null && (
        <Banner
          fullMode={false}
          type="success"
          closeIcon={null}
          className="channelEditor__banner"
          title={<div className="channelEditor__bannerTitle">{t('notification.successTitle')}</div>}
          description={<p dangerouslySetInnerHTML={{ __html: successMessage }} />}
        />
      )}

      <div className="channelEditor__field">
        <label className="channelEditor__label" htmlFor="channelEditorName">
          {t('notification.channels.nameLabel')}
        </label>
        <Input
          id="channelEditorName"
          value={draft.name}
          placeholder={t('notification.channels.namePlaceholder')}
          onChange={(value) => setDraft({ ...draft, name: value })}
        />
        <div className="channelEditor__extra">{t('notification.channels.nameHelp')}</div>
      </div>

      <div className="channelEditor__field">
        <div className="channelEditor__label">{t('notification.channels.typeLabel')}</div>
        <div>{adapterConfig.name}</div>
        <div className="channelEditor__extra">{adapterConfig.description}</div>
      </div>

      {currentUser?.isAdmin && (
        <div className="channelEditor__field">
          <div className="channelEditor__label">{t('notification.channels.visibilityLabel')}</div>
          <Select
            value={draft.visibility}
            style={{ width: 220 }}
            onChange={(value) => setDraft({ ...draft, visibility: String(value) })}
            optionList={[
              { value: 'private', label: t('notification.channels.visibilityPrivate') },
              { value: 'admin', label: t('notification.channels.visibilityAdmin') },
              { value: 'everyone', label: t('notification.channels.visibilityEveryone') },
            ]}
          />
          <div className="channelEditor__extra">{t('notification.channels.visibilityHelp')}</div>
        </div>
      )}

      {adapterConfig.readme != null && <Help readme={adapterConfig.readme} />}

      {Object.entries(adapterConfig.fields ?? {}).map(([key, definition]) =>
        definition.type === 'boolean' ? (
          <div key={key} className="channelEditor__field">
            <div className="channelEditor__switchRow">
              <Switch checked={draft.fields[key] === true} onChange={(checked) => setField(key, checked)} />
              <span>{definition.label}</span>
            </div>
            {definition.description && <div className="channelEditor__extra">{definition.description}</div>}
          </div>
        ) : (
          <div key={key} className="channelEditor__field">
            <label className="channelEditor__label" htmlFor={`channelEditorField-${key}`}>
              {definition.label}
            </label>
            <Input
              id={`channelEditorField-${key}`}
              // A credential is masked in the form as well as on the wire. `mode="password"`
              // gives Semi's reveal toggle, so the owner can still check what they typed.
              mode={definition.secret === true ? 'password' : undefined}
              type={definition.type === 'number' ? 'number' : 'text'}
              value={(draft.fields[key] as string | number | undefined) ?? ''}
              placeholder={definition.label}
              onChange={(value) => setField(key, value)}
            />
            {definition.description && <div className="channelEditor__extra">{definition.description}</div>}
          </div>
        ),
      )}
    </Modal>
  );
}
