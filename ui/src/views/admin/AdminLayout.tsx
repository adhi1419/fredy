/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactElement } from 'react';

import SettingsShell from '../../components/settingsShell/SettingsShell.jsx';
import type { SettingsShellTab } from '../../components/settingsShell/SettingsShell.jsx';
import ScopeBanner from './ScopeBanner.jsx';
import { useAdminSettings } from './useAdminSettings.js';
import type { GeneralSettings } from './useAdminSettings.js';
import { useSelector } from '../../services/state/store';
import { useTranslation } from '../../services/i18n/i18n.jsx';

/** The store slice the layout reads to seed the shared admin form. */
interface AdminLayoutState {
  generalSettings: { settings: GeneralSettings | null | undefined };
}

/**
 * Administration: everything that applies to the instance rather than to the person looking at it.
 *
 * The tabs are the only place these pages are named. The sidebar used to list them all as well,
 * directly above a strip repeating them, so it carries a single "Administration" entry now.
 *
 * The layout owns `useAdminSettings` so that System, Execution and Connectivity keep sharing one
 * form across a route change - switching tabs with unsaved edits must not silently discard them -
 * while each page still saves only its own fields.
 */
export default function AdminLayout(): ReactElement {
  const t = useTranslation();
  const settings = useSelector<AdminLayoutState, AdminLayoutState['generalSettings']['settings']>(
    (state) => state.generalSettings.settings,
  );
  const admin = useAdminSettings(settings);

  const tabs: SettingsShellTab[] = [
    { path: '/admin/system', label: t('admin.tabSystem') },
    { path: '/admin/execution', label: t('admin.tabExecution') },
    { path: '/admin/connectivity', label: t('admin.tabConnectivity') },
  ];

  return (
    <SettingsShell
      eyebrow={t('settings.title')}
      title={t('nav.adminPanel')}
      tabs={tabs}
      banner={<ScopeBanner />}
      context={admin}
    />
  );
}

AdminLayout.displayName = 'AdminLayout';
