/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement, ReactNode } from 'react';
import { Button, Empty, Select, Table, Tag, Tooltip } from '@douyinfe/semi-ui-19';
import { IconCopy, IconDelete, IconEdit, IconSend, IconMinusCircle, IconPlus } from '@douyinfe/semi-icons';

import { useScreenWidth } from '../../hooks/screenWidth.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import './NotificationChannelTable.less';

type ChannelVisibility = 'private' | 'admin' | 'everyone';
type ChannelAction = 'add' | 'test' | 'edit' | 'clone' | 'delete' | 'detach';

/** Channel DTO from `/api/notificationChannels`. Loosely typed - the table reads a known subset. */
interface Channel {
  id: string;
  name?: string;
  adapterName?: string;
  destination?: string | null;
  visibility?: ChannelVisibility | string;
  usedByJobs?: number;
  canEdit?: boolean;
  [key: string]: unknown;
}

interface NotificationChannelTableProps {
  channels?: Channel[];
  actions?: ReadonlyArray<ChannelAction>;
  onAdd?: (channel: Channel) => void;
  onTest?: (channel: Channel) => void;
  onEdit?: (channel: Channel) => void;
  onClone?: (channel: Channel) => void;
  onDelete?: (channel: Channel) => void;
  onDetach?: (channel: Channel) => void;
  /** Renders a control instead of a label. */
  canManageVisibility?: boolean;
  onVisibilityChange?: (channel: Channel, visibility: string) => void;
  showVisibility?: boolean;
  showUsage?: boolean;
  emptyText?: ReactNode;
}

/**
 * The one table that renders notification channels, used by the Settings page and by the job form.
 *
 * Sharing it is deliberate. The Destination column and the visibility labels are what a user reads
 * to decide whether a channel is the right one, and two copies of that would drift apart. The two
 * places differ only in which actions they offer, which is what `actions` selects - note that the
 * job form offers `detach` (remove from this job) where Settings offers `delete` (remove from the
 * instance). Two verbs, because they are two different actions.
 *
 * Below 700px the columns collapse into a single stacked cell. A five-column table on a phone
 * either scrolls sideways, which hides the actions, or squeezes a destination into a two-character
 * column - neither is a table anyone can use.
 */
export default function NotificationChannelTable({
  channels = [],
  actions = ['test', 'edit', 'clone', 'delete'],
  onAdd,
  onTest,
  onEdit,
  onClone,
  onDelete,
  onDetach,
  canManageVisibility = false,
  onVisibilityChange,
  showVisibility = true,
  showUsage = true,
  emptyText,
}: NotificationChannelTableProps = {}): ReactElement {
  const t = useTranslation();
  const width = useScreenWidth();
  const isNarrow = width <= 700;

  const visibilityOptions = [
    { value: 'private', label: t('notification.channels.visibilityPrivate') },
    { value: 'admin', label: t('notification.channels.visibilityAdmin') },
    { value: 'everyone', label: t('notification.channels.visibilityEveryone') },
  ];

  const visibilityLabel = (visibility: string) =>
    visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility;

  // The i18n helper has no plural machinery, so the singular is its own key rather than a
  // "{{count}} jobs" that reads "1 jobs".
  const usageLabel = (count: number) => {
    if (count === 0) return t('notification.channels.usageNone');
    if (count === 1) return t('notification.channels.usageJobsOne');
    return t('notification.channels.usageJobs', { count });
  };

  const visibilityCell = (visibility: string, record: Channel) =>
    canManageVisibility && record.canEdit ? (
      <Select
        value={visibility}
        style={{ width: isNarrow ? '100%' : 150 }}
        onChange={(value) => onVisibilityChange?.(record, value as string)}
        optionList={visibilityOptions}
      />
    ) : (
      visibilityLabel(visibility)
    );

  const toolsCell = (record: Channel) => (
    <div className="notificationChannelTable__tools">
      {actions.includes('add') && (
        <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => onAdd?.(record)}>
          {t('notification.channels.add')}
        </Button>
      )}
      {actions.includes('test') && (
        <Tooltip content={t('notification.channels.actionTest')}>
          <Button type="tertiary" theme="borderless" icon={<IconSend />} onClick={() => onTest?.(record)} />
        </Tooltip>
      )}
      {actions.includes('edit') && record.canEdit && (
        <Tooltip content={t('notification.channels.actionEdit')}>
          <Button type="secondary" icon={<IconEdit />} onClick={() => onEdit?.(record)} />
        </Tooltip>
      )}
      {actions.includes('clone') && (
        <Tooltip content={t('notification.channels.actionClone')}>
          <Button type="tertiary" theme="borderless" icon={<IconCopy />} onClick={() => onClone?.(record)} />
        </Tooltip>
      )}
      {actions.includes('detach') && (
        <Tooltip content={t('notification.channels.actionDetach')}>
          <Button type="danger" theme="borderless" icon={<IconMinusCircle />} onClick={() => onDetach?.(record)} />
        </Tooltip>
      )}
      {actions.includes('delete') && record.canEdit && (
        <Tooltip
          content={
            (record.usedByJobs ?? 0) > 0
              ? t('notification.channels.deleteBlocked')
              : t('notification.channels.actionDelete')
          }
        >
          {/* Wrapped in a span: a disabled Button swallows the events the Tooltip listens for,
              so the explanation for why Delete is greyed out would never appear. */}
          <span>
            <Button
              type="danger"
              icon={<IconDelete />}
              disabled={(record.usedByJobs ?? 0) > 0}
              onClick={() => onDelete?.(record)}
            />
          </span>
        </Tooltip>
      )}
    </div>
  );

  const narrowColumns = [
    {
      title: t('notification.channels.columnName'),
      dataIndex: 'name',
      render: (name: string, record: Channel) => (
        <div className="notificationChannelTable__stack">
          <div className="notificationChannelTable__stackHead">
            <span className="notificationChannelTable__stackName">{name}</span>
            <Tag color="grey" size="small">
              {record.adapterName}
            </Tag>
          </div>
          <div className="notificationChannelTable__destination">{record.destination ?? '-'}</div>
          {(showVisibility || showUsage) && (
            <div className="notificationChannelTable__stackMeta">
              {showVisibility && <span>{visibilityCell(record.visibility as string, record)}</span>}
              {showUsage && <span>{usageLabel(record.usedByJobs ?? 0)}</span>}
            </div>
          )}
          {toolsCell(record)}
        </div>
      ),
    },
  ];

  const wideColumns: Array<Record<string, unknown>> = [
    { title: t('notification.channels.columnName'), dataIndex: 'name' },
    {
      title: t('notification.channels.columnType'),
      dataIndex: 'adapterName',
      render: (adapterName: string) => <Tag color="grey">{adapterName}</Tag>,
    },
    {
      title: t('notification.channels.columnDestination'),
      dataIndex: 'destination',
      render: (destination: string | null) => (
        <span className="notificationChannelTable__destination">{destination ?? '-'}</span>
      ),
    },
  ];

  if (showVisibility) {
    wideColumns.push({
      title: t('notification.channels.columnVisibility'),
      dataIndex: 'visibility',
      render: visibilityCell,
    });
  }

  if (showUsage) {
    wideColumns.push({
      title: t('notification.channels.columnUsage'),
      dataIndex: 'usedByJobs',
      render: (usedByJobs: number) => usageLabel(usedByJobs ?? 0),
    });
  }

  wideColumns.push({ title: '', dataIndex: 'tools', render: (_: unknown, record: Channel) => toolsCell(record) });

  return (
    <Table
      className="notificationChannelTable"
      pagination={false}
      rowKey="id"
      empty={<Empty description={emptyText ?? t('notification.channels.empty')} />}
      columns={isNarrow ? narrowColumns : wideColumns}
      dataSource={channels}
    />
  );
}
