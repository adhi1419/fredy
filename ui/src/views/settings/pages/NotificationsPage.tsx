/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Banner, Button, Modal, Select, Toast } from '@douyinfe/semi-ui-19';
import { IconPlusCircle, IconArrowLeft } from '@douyinfe/semi-icons';
import { useNavigate, useSearchParams } from 'react-router';

import NotificationChannelTable from '../../../components/table/NotificationChannelTable';
import NotificationChannelEditor from '../../jobs/mutation/components/notificationAdapter/NotificationChannelEditor';
import { useActions, useSelector } from '../../../services/state/store';
import type {
  NotificationAdapter,
  NotificationAdapterEffects,
  NotificationChannelEffects,
} from '../../../services/state/notificationState.js';
import { errorMessage } from '../../../services/xhr';
import { sanitizeReturnTo } from '../../../services/routes/returnTo.js';
import { useTranslation } from '../../../services/i18n/i18n.jsx';

import './NotificationsPage.less';

/** A saved channel as this page reads it: an id plus the loosely-typed adapter fields. Matches the
 *  shape `NotificationChannelTable` accepts. */
type Channel = { id: string; [key: string]: unknown };

/** A job blocking a channel deletion, as the route reports it. */
interface BlockingJob {
  name: string;
}

/** Which channel-visibility settings the current viewer may manage. */
interface CurrentUser {
  isAdmin?: boolean;
}

/** The editor dialog target: creating a new channel of a type, or editing/cloning an existing one. */
type EditorState =
  | { mode: 'create'; adapterId: string; channelId?: undefined }
  | { mode: 'edit' | 'clone'; channelId: string; adapterId?: undefined };

/** The store slices this page reads. */
interface NotificationsPageState {
  notificationChannels: { channels: Channel[] };
  notificationAdapter: readonly NotificationAdapter[];
  user: { currentUser: CurrentUser | null };
}

/** The effects this page dispatches. */
interface NotificationsPageActions {
  notificationChannels: NotificationChannelEffects;
  notificationAdapter: NotificationAdapterEffects;
}

/** A rejected request that may carry the jobs still using a channel. */
interface DeleteBlockedError {
  json?: { jobs?: BlockingJob[] };
}

/**
 * Where notification channels are managed.
 *
 * Deliberately not admin-only. A normal user has to be able to set up their own Telegram, which
 * used to happen inside the job form; making this admin-only would take that away. Admins
 * additionally get the visibility control that shares a channel they own with everyone or with
 * administrators; other people's private channels stay hidden from them like anyone else.
 */
export default function NotificationsPage(): ReactElement {
  const t = useTranslation();
  const actions = useActions<NotificationsPageActions>();
  const channels = useSelector<NotificationsPageState, Channel[]>((state) => state.notificationChannels.channels);
  const adapters = useSelector<NotificationsPageState, readonly NotificationAdapter[]>(
    (state) => state.notificationAdapter,
  );
  const currentUser = useSelector<NotificationsPageState, CurrentUser | null>((state) => state.user.currentUser);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pickingType, setPickingType] = useState(false);

  // Someone sent here from a job they were half-way through filling in. The value is checked
  // rather than trusted: it arrives in the URL, so a crafted link could otherwise point this
  // button off the site entirely.
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  useEffect(() => {
    actions.notificationChannels.getChannels();
    actions.notificationAdapter.getAdapter();
  }, [actions]);

  const test = async (channel: Channel) => {
    try {
      await actions.notificationChannels.tryChannel(channel.id);
      Toast.success(t('notification.trySuccess'));
    } catch (error) {
      Toast.error(t('notification.tryError', { error: errorMessage(error, t('common.unknownError')) }));
    }
  };

  const remove = async (channel: Channel) => {
    try {
      await actions.notificationChannels.removeChannel(channel.id);
      Toast.success(t('notification.channels.deleted'));
    } catch (error) {
      // The route answers a blocked delete with the jobs still using the channel, so the toast can
      // name them instead of saying "conflict" and leaving the user to guess.
      const jobs = (error as DeleteBlockedError)?.json?.jobs;
      Toast.error(
        jobs?.length
          ? t('notification.channels.deleteBlockedToast', { jobs: jobs.map((job) => job.name).join(', ') })
          : errorMessage(error, t('common.unknownError')),
      );
    }
  };

  const changeVisibility = async (channel: Channel, visibility: string) => {
    try {
      // Only the visibility travels: the save route keeps any key the body omits, so the stored
      // credentials are never round-tripped through the browser just to flip this one field.
      await actions.notificationChannels.saveChannel({ id: channel.id, name: String(channel.name ?? ''), visibility });
    } catch (error) {
      Toast.error(errorMessage(error, t('common.unknownError')));
    }
  };

  const adapterOptions = adapters
    .filter((adapter): adapter is NotificationAdapter => Boolean(adapter))
    .map((adapter) => ({ value: String(adapter.id), label: String(adapter.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      {returnTo != null && (
        <Button
          icon={<IconArrowLeft />}
          theme="borderless"
          style={{ marginBottom: '1rem' }}
          onClick={() => navigate(returnTo)}
        >
          {t('notification.channels.backToJob')}
        </Button>
      )}

      {currentUser?.isAdmin && (
        <Banner
          fullMode={false}
          type="info"
          closeIcon={null}
          style={{ marginBottom: '1rem' }}
          description={t('notification.channels.scopeBanner')}
        />
      )}

      <Button
        type="primary"
        icon={<IconPlusCircle />}
        style={{ marginBottom: '1rem' }}
        onClick={() => setPickingType(true)}
      >
        {t('notification.channels.new')}
      </Button>

      <NotificationChannelTable
        channels={channels}
        actions={['test', 'edit', 'clone', 'delete']}
        onTest={test}
        onEdit={(channel) => setEditor({ mode: 'edit', channelId: channel.id })}
        onClone={(channel) => setEditor({ mode: 'clone', channelId: channel.id })}
        onDelete={remove}
        canManageVisibility={currentUser?.isAdmin === true}
        onVisibilityChange={changeVisibility}
      />

      {/* Choosing the type is its own step because it is the one decision that cannot be changed
          afterwards - the stored fields only make sense for one adapter. */}
      <Modal
        title={t('notification.channels.createTitle')}
        visible={pickingType}
        onCancel={() => setPickingType(false)}
        footer={null}
      >
        {/* The modal body is otherwise a single control, and Semi collapses it to the height of
            that control - which clipped the select against the modal's bottom edge. */}
        <div className="notificationsPage__typePicker">
          <p className="notificationsPage__typeIntro">{t('notification.channels.typeIntro')}</p>
          <Select
            filter
            style={{ width: '100%' }}
            placeholder={t('notification.selectPlaceholder')}
            optionList={adapterOptions}
            onChange={(adapterId) => {
              setPickingType(false);
              setEditor({ mode: 'create', adapterId: String(adapterId) });
            }}
          />
        </div>
      </Modal>

      {editor && (
        <NotificationChannelEditor
          visible
          mode={editor.mode}
          channelId={editor.channelId}
          adapterId={editor.adapterId}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  );
}

NotificationsPage.displayName = 'NotificationsPage';
