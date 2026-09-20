/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ComponentType, ReactNode } from 'react';

type Channel = { id: string; [key: string]: unknown };
type ChannelAction = 'add' | 'test' | 'edit' | 'clone' | 'delete' | 'detach';

interface NotificationChannelTableProps {
  channels?: readonly Channel[];
  actions?: readonly ChannelAction[];
  onAdd?: (channel: Channel) => void;
  onTest?: (channel: Channel) => void;
  onEdit?: (channel: Channel) => void;
  onClone?: (channel: Channel) => void;
  onDelete?: (channel: Channel) => void;
  onDetach?: (channel: Channel) => void;
  canManageVisibility?: boolean;
  onVisibilityChange?: (channel: Channel, visibility: string) => void;
  showVisibility?: boolean;
  showUsage?: boolean;
  emptyText?: ReactNode;
}

const NotificationChannelTable: ComponentType<NotificationChannelTableProps>;
export default NotificationChannelTable;
