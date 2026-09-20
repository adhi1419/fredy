/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Card, Popover } from '@douyinfe/semi-ui-19';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import type { ElementType, ReactNode } from 'react';

import './SegmentParts.less';

/**
 * A titled card holding one group of controls.
 *
 * `helpMode` decides what happens to the explanation:
 *
 * - `inline` (the default) prints it under the title. Right for a settings page, where the reader
 *   is deciding whether they want the setting at all and there are only two or three of them.
 * - `popover` puts it behind a mark next to the title. Right for the job form, where nine of these
 *   stack up and their help text alone came to some 280 words of permanently visible prose - which
 *   is read once, on the first job, and is in the way on every job after that.
 */
export interface SegmentPartProps {
  name: string;
  Icon?: ElementType;
  children?: ReactNode;
  helpText?: string | null;
  helpMode?: 'inline' | 'popover';
  className?: string;
}

export const SegmentPart = ({
  name,
  Icon = undefined,
  children,
  helpText = null,
  helpMode = 'inline',
  className = '',
}: SegmentPartProps) => {
  const { Meta } = Card;
  const asPopover = helpMode === 'popover' && helpText != null;

  const title = asPopover ? (
    <span className="segmentParts__title">
      {name}
      <Popover content={<div className="segmentParts__help">{helpText}</div>} position="right" showArrow>
        <button type="button" className="segmentParts__helpMark" aria-label={helpText}>
          <IconHelpCircle size="small" />
        </button>
      </Popover>
    </span>
  ) : (
    name
  );

  return (
    <Card
      className={`segmentParts ${className}`}
      title={
        (helpText || name) && (
          <Meta
            title={title}
            description={asPopover ? null : helpText}
            avatar={Icon == null ? null : <Icon size="extra-extra-small" />}
          />
        )
      }
    >
      {children}
    </Card>
  );
};
