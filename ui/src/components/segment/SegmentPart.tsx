/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Popover } from '@douyinfe/semi-ui-19';
import { IconHelpCircle } from '@douyinfe/semi-icons';
import type { ElementType, ReactNode } from 'react';

import './SegmentParts.less';

/**
 * One titled group of controls: a heading, its explanation, the controls, and a hairline beneath.
 * Several of these stacked make a settings page or a wizard step; there is no box around any of
 * them, the rules between them are the structure.
 *
 * `helpMode` decides what happens to the explanation:
 *
 * - `inline` (the default) prints it under the title. Right for a settings page, where the reader
 *   is deciding whether they want the setting at all and there are only two or three of them.
 * - `popover` puts it behind a mark next to the title. Right for the job form, where nine of these
 *   stack up and their help text alone came to some 280 words of permanently visible prose - which
 *   is read once, on the first job, and is in the way on every job after that.
 *
 * `Icon` is accepted for compatibility and no longer rendered: the heading carries the meaning.
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
  children,
  helpText = null,
  helpMode = 'inline',
  className = '',
}: SegmentPartProps) => {
  const asPopover = helpMode === 'popover' && helpText != null;

  return (
    <section className={`segmentParts ${className}`}>
      <header className="segmentParts__header">
        <h2 className="segmentParts__title">
          {name}
          {asPopover && (
            <Popover content={<div className="segmentParts__help">{helpText}</div>} position="right" showArrow>
              <button type="button" className="segmentParts__helpMark" aria-label={helpText}>
                <IconHelpCircle size="small" />
              </button>
            </Popover>
          )}
        </h2>
        {!asPopover && helpText && <p className="segmentParts__description">{helpText}</p>}
      </header>
      <div className="segmentParts__body">{children}</div>
    </section>
  );
};
