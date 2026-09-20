/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconBell, IconEdit, IconHome, IconListView, IconMapPin } from '@douyinfe/semi-icons';
import type { ElementType, ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { useTranslation } from '../../services/i18n/i18n.jsx';

import './SettingsLayout.less';

interface PersonalSettingsSection {
  path: string;
  labelKey: string;
  Icon: ElementType;
}

export const PERSONAL_SETTINGS_SECTIONS: readonly PersonalSettingsSection[] = [
  { path: '/settings/preferences', labelKey: 'settings.tabPreferences', Icon: IconHome },
  { path: '/settings/travel-time', labelKey: 'settings.tabTravelTime', Icon: IconMapPin },
  { path: '/settings/listings', labelKey: 'settings.tabListingDetails', Icon: IconListView },
  { path: '/settings/notifications', labelKey: 'settings.tabNotifications', Icon: IconBell },
  { path: '/settings/inquiry-profile', labelKey: 'settings.tabInquiryProfile', Icon: IconEdit },
];

export function personalSettingsSectionFor(pathname: string): string {
  return (
    PERSONAL_SETTINGS_SECTIONS.find((section) => pathname === section.path || pathname.startsWith(`${section.path}/`))
      ?.path ?? PERSONAL_SETTINGS_SECTIONS[0].path
  );
}

export default function SettingsLayout(): ReactNode {
  const t = useTranslation();
  const location = useLocation();
  const activeSection = personalSettingsSectionFor(location.pathname);

  return (
    <div className="settingsLayout">
      <header className="settingsLayout__heading">
        <span>{t('settings.accountEyebrow')}</span>
        <h1 id="my-account-title">{t('settings.title')}</h1>
        <p>{t('settings.accountDescription')}</p>
      </header>
      <div className="settingsLayout__body">
        <nav className="settingsLayout__nav" aria-labelledby="my-account-title">
          {PERSONAL_SETTINGS_SECTIONS.map(({ path, labelKey, Icon }) => {
            const current = activeSection === path;
            return (
              <NavLink
                key={path}
                to={path}
                className={`settingsLayout__navItem${current ? ' is-active' : ''}`}
                aria-current={current ? 'page' : undefined}
              >
                <Icon size="small" aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </NavLink>
            );
          })}
        </nav>
        <section className="settingsLayout__content" aria-live="polite">
          <Outlet />
        </section>
      </div>
    </div>
  );
}

SettingsLayout.displayName = 'SettingsLayout';
