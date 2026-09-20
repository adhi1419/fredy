/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement, ReactNode } from 'react';
import { SideSheet, Button } from '@douyinfe/semi-ui-19';

import { useTranslation } from '../../services/i18n/i18n.jsx';

import './FilterDrawer.less';

interface FilterDrawerProps {
  visible: boolean;
  onClose: () => void;
  activeCount: number;
  onClearAll: () => void;
  /** One or more {@link FilterGroup}. */
  children: ReactNode;
}

/**
 * The drawer a page's filters live in.
 *
 * Shared by the listings and the jobs pages so that "where are the filters" has one answer and one
 * shape wherever you are, rather than a row of controls on one page and a drawer on the other.
 */
export default function FilterDrawer({
  visible,
  onClose,
  activeCount,
  onClearAll,
  children,
}: FilterDrawerProps): ReactElement {
  const t = useTranslation();

  return (
    <SideSheet
      title={t('listings.filtersTitle')}
      visible={visible}
      onCancel={onClose}
      placement="right"
      width={360}
      className="filterDrawer"
      footer={
        <div className="filterDrawer__footer">
          <Button theme="borderless" disabled={activeCount === 0} onClick={onClearAll}>
            {t('listings.filterClearAll')}
          </Button>
          <Button theme="solid" type="primary" onClick={onClose}>
            {t('listings.filtersDone')}
          </Button>
        </div>
      }
    >
      {children}
    </SideSheet>
  );
}

FilterDrawer.displayName = 'FilterDrawer';

interface FilterGroupProps {
  title: string;
  children: ReactNode;
}

/**
 * One labelled block of filters inside the drawer.
 */
export function FilterGroup({ title, children }: FilterGroupProps): ReactElement {
  return (
    <div className="filterDrawer__group">
      <h4 className="filterDrawer__groupTitle">{title}</h4>
      {children}
    </div>
  );
}

FilterGroup.displayName = 'FilterGroup';

interface FilterHelpProps {
  children: ReactNode;
}

/**
 * Explanatory text for a control, in the room the drawer has and the topbar did not.
 */
export function FilterHelp({ children }: FilterHelpProps): ReactElement {
  return <p className="filterDrawer__help">{children}</p>;
}

FilterHelp.displayName = 'FilterHelp';
