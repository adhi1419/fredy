/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ComponentType } from 'react';

type Channel = { id: string; [key: string]: unknown };

interface NotificationChannelPickerProps {
  visible: boolean;
  selectedIds?: readonly string[];
  onClose: () => void;
  onPick: (channel: Channel) => void;
  onManageChannels?: () => void;
}

const NotificationChannelPicker: ComponentType<NotificationChannelPickerProps>;
export default NotificationChannelPicker;
