/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconHome, IconSearch } from '@douyinfe/semi-icons';
import type { ElementType, MouseEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { homeSearchForNavigation } from '../../services/home/homeViewState.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import MyAccountWireframeMenu from '../myAccountWireframe/MyAccountWireframeMenu.js';
import type { AccountIdentity } from '../myAccountWireframe/MyAccountWireframeMenu.js';
import { PRIMARY_NAV, resolvePrimaryKey } from './navModel.js';
import type { PrimaryDestination } from './navModel.js';

import './Navigate.less';

const ICONS: Record<PrimaryDestination['key'], ElementType> = {
  home: IconHome,
  'saved-searches': IconSearch,
};

interface NavigationProps {
  currentUser?: AccountIdentity | null;
  isAdmin?: boolean;
  photoUrl?: string | null;
  primaryVisible?: boolean;
}

export default function Navigation({
  currentUser,
  isAdmin = false,
  photoUrl = null,
  primaryVisible = true,
}: NavigationProps): ReactNode {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const activeKey = primaryVisible ? resolvePrimaryKey(location.pathname) : null;

  const goTo = (path: string) => {
    const preservedSearch = path === '/dashboard' ? homeSearchForNavigation(location.pathname, location.search) : '';
    navigate(`${path}${preservedSearch}`);
  };

  const focusMainContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('fredy-main-content')?.focus();
  };

  const primaryLink = (item: PrimaryDestination, mobile = false) => {
    const Icon = ICONS[item.key];
    return (
      <button
        key={item.key}
        type="button"
        className={`fredy-shell-nav__primary-link${activeKey === item.key ? ' is-active' : ''}`}
        aria-current={activeKey === item.key ? 'page' : undefined}
        onClick={() => goTo(item.path)}
      >
        <Icon size={mobile ? 'default' : 'small'} aria-hidden="true" />
        <span>{t(item.labelKey)}</span>
      </button>
    );
  };

  return (
    <>
      <a className="fredy-shell-skip-link" href="#fredy-main-content" onClick={focusMainContent}>
        {t('nav.skipToContent')}
      </a>
      <header className="fredy-shell-nav">
        <button
          type="button"
          className="fredy-shell-nav__brand"
          onClick={() => goTo('/dashboard')}
          aria-label={t('nav.home')}
        >
          Fredy
        </button>
        <nav className="fredy-shell-nav__desktop-primary" aria-label={t('nav.primary')} aria-hidden={!primaryVisible}>
          {primaryVisible && PRIMARY_NAV.map((item) => primaryLink(item))}
        </nav>
        <div className="fredy-shell-nav__account-wrap">
          <MyAccountWireframeMenu
            currentUser={currentUser}
            isAdmin={isAdmin}
            photoUrl={photoUrl}
            primaryVisible={primaryVisible}
          />
        </div>
      </header>
      {primaryVisible && (
        <nav className="fredy-shell-nav__mobile-primary" aria-label={t('nav.primary')}>
          {PRIMARY_NAV.map((item) => primaryLink(item, true))}
        </nav>
      )}
    </>
  );
}

Navigation.displayName = 'Navigation';
