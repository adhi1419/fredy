/* Copyright (c) 2026 by Christian Kellner. */
import type { ComponentType } from 'react';

const AreaFilter: ComponentType<{
  spatialFilter?: unknown | null;
  onChange?: (value: unknown) => void;
  providerData?: readonly { id?: string }[];
}>;
export default AreaFilter;
