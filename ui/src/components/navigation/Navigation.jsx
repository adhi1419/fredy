/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useRef, useState } from 'react';
import { IconHome, IconSearch, IconUser } from '@douyinfe/semi-icons';
import { useLocation, useNavigate } from 'react-router';
import { useActions } from '../../services/state/store';
import { signOutFirebase } from '../../services/auth/firebaseAuth.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { ACCOUNT_NAV, PRIMARY_NAV, resolvePrimaryKey } from './navModel.js';
import { homeSearchForNavigation } from '../../services/home/homeViewState.js';

import './Navigate.less';

const ICONS = { home: IconHome, 'saved-searches': IconSearch };

/**
 * The application shell. Page bodies remain owned by their existing routes; this component only
 * owns the two primary destinations and the account escape hatch for settings/admin.
 */
export default function Navigation({ isAdmin, primaryVisible = true }) {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useActions();
  const accountRef = useRef(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const activeKey = primaryVisible ? resolvePrimaryKey(location.pathname) : null;

  useEffect(() => {
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    const closeOnOutsidePointer = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [accountOpen]);

  const goTo = (path) => {
    setAccountOpen(false);
    const preservedSearch = path === '/dashboard' ? homeSearchForNavigation(location.pathname, location.search) : '';
    navigate(`${path}${preservedSearch}`);
  };

  const handleSignOut = async () => {
    setAccountOpen(false);
    try {
      await signOutFirebase();
    } finally {
      actions.user.resetCurrentUser();
      navigate('/login', { replace: true });
    }
  };

  const primaryLink = (item, mobile = false) => {
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

  const accountItems = primaryVisible ? ACCOUNT_NAV.filter((item) => !item.adminOnly || isAdmin) : [];

  return (
    <>
      <header className="fredy-shell-nav" ref={accountRef}>
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
          <button
            type="button"
            className="fredy-shell-nav__account-button"
            aria-label={t('nav.openAccountMenu')}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((open) => !open)}
          >
            <IconUser size="small" aria-hidden="true" />
            <span className="fredy-shell-nav__account-label">{t('nav.account')}</span>
          </button>
          {accountOpen && (
            <div className="fredy-shell-nav__account-menu" role="menu" aria-label={t('nav.accountMenu')}>
              {accountItems.map((item) => (
                <button key={item.key} type="button" role="menuitem" onClick={() => goTo(item.path)}>
                  {t(item.labelKey)}
                </button>
              ))}
              <button type="button" role="menuitem" onClick={handleSignOut}>
                {t('nav.signOut')}
              </button>
            </div>
          )}
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
