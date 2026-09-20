/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ComponentType } from 'react';

type Channel = { id: string; [key: string]: unknown };

interface NotificationChannelEditorProps {
  visible: boolean;
  mode: 'create' | 'edit' | 'clone';
  channelId?: string | null;
  adapterId?: string | null;
  warnUsageAbove?: number;
  onClose: () => void;
  onSaved?: (channel: Channel) => void;
}

const NotificationChannelEditor: ComponentType<NotificationChannelEditorProps>;
export default NotificationChannelEditor;
