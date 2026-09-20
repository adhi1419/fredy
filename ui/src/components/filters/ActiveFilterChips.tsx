/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement } from 'react';
import { Tag, Button } from '@douyinfe/semi-ui-19';

import { useTranslation } from '../../services/i18n/i18n.jsx';

import './ActiveFilterChips.less';

interface FilterChip {
  key: string;
  label: string;
}

interface ActiveFilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

/**
 * What a page is currently filtered by, as removable chips.
 *
 * The filters themselves live in a drawer, and a drawer is a place things get forgotten in. This
 * row is the receipt: it names every filter that is on, and each chip is also the way to switch
 * that one off, so nothing can be hiding rows without saying so on screen.
 *
 * Renders nothing when nothing is on, rather than an empty bar that has to be explained.
 *
 * Takes chips already described, rather than a filter state and a way to read it, so the listings
 * and jobs pages can share it without it knowing what either of them filters by.
 */
export default function ActiveFilterChips({
  chips,
  onRemove,
  onClearAll,
}: ActiveFilterChipsProps): ReactElement | null {
  const t = useTranslation();

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="activeFilterChips">
      {chips.map((chip) => (
        <Tag
          key={chip.key}
          closable
          type="light"
          size="large"
          className="activeFilterChips__chip"
          aria-label={t('listings.filterChipRemove', { name: chip.label })}
          onClose={() => onRemove(chip.key)}
        >
          {chip.label}
        </Tag>
      ))}
      {/* Offered from two chips up. With one on screen it would be a second button doing exactly
          what the chip's own cross already does. */}
      {chips.length > 1 && (
        <Button theme="borderless" size="small" onClick={onClearAll}>
          {t('listings.filterClearAll')}
        </Button>
      )}
    </div>
  );
}

ActiveFilterChips.displayName = 'ActiveFilterChips';
