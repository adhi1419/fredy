/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import SettingsRouteTabs, { type SettingsRouteTab } from '../../components/settingsRouteTabs/SettingsRouteTabs.jsx';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { useSelector } from '../../services/state/store';
import '../settings/SettingsLayout.less';

/** One tab of the admin panel. */
interface AdminSection {
  path: string;
  labelKey: string;
}

/**
 * The admin panel's sections, in tab order. Access requests is the first; the monitoring dashboard
 * (cost, performance, failures) is the next entry on this list.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { path: '/admin/access-requests', labelKey: 'admin.tabAccessRequests' },
  { path: '/admin/monitoring', labelKey: 'admin.tabMonitoring' },
];

/** The section a pathname belongs to, defaulting to the first. */
export function adminSectionFor(pathname: string): string {
  return (
    ADMIN_SECTIONS.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`))?.path ??
    ADMIN_SECTIONS[0].path
  );
}

/** The signed-in user's admin flag, read straight off the store. */
interface CurrentUserShape {
  isAdmin?: boolean;
}

/**
 * The admin panel shell: the same heading block and hairline tab rail as My account, so the two
 * areas sit in the same place on the page with different tab lists. Non-admins are sent to /403.
 */
export default function AdminLayout(): ReactNode {
  const t = useTranslation();
  const location = useLocation();
  const currentUser = useSelector<{ user: { currentUser: unknown } }, CurrentUserShape | null>(
    (state) => state.user.currentUser as CurrentUserShape | null,
  );

  if (currentUser?.isAdmin !== true) {
    return <Navigate to="/403" replace />;
  }

  const tabs: readonly SettingsRouteTab[] = ADMIN_SECTIONS.map(({ path, labelKey }) => ({
    path,
    label: t(labelKey),
  }));

  return (
    <div className="settingsLayout">
      <header className="settingsLayout__heading">
        <span>{t('admin.title')}</span>
        <h1 id="admin-panel-title">{t('nav.adminPanel')}</h1>
        <p>{t('admin.description')}</p>
      </header>
      <SettingsRouteTabs tabs={tabs} ariaLabel={t('nav.adminPanel')} className="settingsLayout__nav" />
      <section className="settingsLayout__content" aria-live="polite" key={location.pathname}>
        <Outlet />
      </section>
    </div>
  );
}

AdminLayout.displayName = 'AdminLayout';
