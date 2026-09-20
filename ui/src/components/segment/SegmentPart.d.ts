/* Copyright (c) 2026 by Christian Kellner. */
import type { ComponentType, ElementType, ReactNode } from 'react';

export interface SegmentPartProps {
  name: string;
  Icon?: ElementType;
  children?: ReactNode;
  helpText?: string;
  helpMode?: 'inline' | 'popover';
  className?: string;
}

declare const SegmentPart: ComponentType<SegmentPartProps>;

export { SegmentPart };
