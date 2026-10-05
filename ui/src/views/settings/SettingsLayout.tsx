/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';

import SettingsRouteTabs, { type SettingsRouteTab } from '../../components/settingsRouteTabs/SettingsRouteTabs.jsx';
import { useTranslation } from '../../services/i18n/i18n.jsx';

import './SettingsLayout.less';

interface PersonalSettingsSection {
  path: string;
  labelKey: string;
}

export const PERSONAL_SETTINGS_SECTIONS: readonly PersonalSettingsSection[] = [
  { path: '/settings/preferences', labelKey: 'settings.tabPreferences' },
  { path: '/settings/travel-time', labelKey: 'settings.tabTravelTime' },
  { path: '/settings/notifications', labelKey: 'settings.tabNotifications' },
  { path: '/settings/inquiry-profile', labelKey: 'settings.tabInquiryProfile' },
];

export function personalSettingsSectionFor(pathname: string): string {
  return (
    PERSONAL_SETTINGS_SECTIONS.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`))
      ?.path ?? PERSONAL_SETTINGS_SECTIONS[0].path
  );
}

export default function SettingsLayout(): ReactNode {
  const t = useTranslation();
  // Read only to key aria-live; SettingsRouteTabs derives its own active tab from the URL.
  const location = useLocation();

  // The bespoke vertical rail is gone: Account Preferences and Administration now navigate through
  // the one shared SettingsRouteTabs rail (URL-driven, horizontally scrollable, keyboard-navigable),
  // so the two areas look and behave identically with different tab lists.
  // Text-only tabs: the labels are short and the rail is a hairline, so a glyph per tab is noise.
  const tabs: readonly SettingsRouteTab[] = PERSONAL_SETTINGS_SECTIONS.map(({ path, labelKey }) => ({
    path,
    label: t(labelKey),
  }));

  return (
    <div className="settingsLayout">
      <header className="settingsLayout__heading">
        <span>{t('settings.title')}</span>
        <h1 id="my-account-title">{t('nav.myAccount')}</h1>
        <p>{t('settings.accountDescription')}</p>
      </header>
      <SettingsRouteTabs tabs={tabs} ariaLabel={t('nav.myAccount')} className="settingsLayout__nav" />
      <section className="settingsLayout__content" aria-live="polite" key={location.pathname}>
        <Outlet />
      </section>
    </div>
  );
}

SettingsLayout.displayName = 'SettingsLayout';
