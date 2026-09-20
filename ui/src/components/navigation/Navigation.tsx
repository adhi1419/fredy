/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { IconAlertCircle, IconHome, IconSearch, IconTickCircle } from '@douyinfe/semi-icons';
import { useEffect, type ElementType, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { countJobsNeedingAttention } from '../../services/dashboard/attention.js';
import { homeSearchForNavigation } from '../../services/home/homeViewState.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { useActions, useSelector } from '../../services/state/store.js';
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

interface NavHealthState {
  jobsData: { jobs: readonly unknown[] };
  dashboard: { data: { general?: { lastRun?: number | null } | null } | null };
}

interface NavHealthActions {
  dashboard: { getDashboard: () => Promise<unknown> };
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
  const actions = useActions<NavHealthActions>();
  const activeKey = primaryVisible ? resolvePrimaryKey(location.pathname) : null;

  // Search health is optional shell evidence, never an application-startup dependency. A failed
  // dashboard refresh leaves the jobs-derived signal usable and must not block the authenticated UI.
  useEffect(() => {
    if (primaryVisible) void actions.dashboard.getDashboard().catch(() => {});
  }, [actions.dashboard, primaryVisible]);

  // The compact search-health signal that replaced the giant Home attention banner. It reads the
  // same jobs and last-run data the attention model already consumes, so the header and the Saved
  // Searches list can never disagree about how many searches want looking at. Only "needs attention"
  // is actionable, so only it links out - to Saved Searches, where the fix lives.
  const jobs = useSelector((state: NavHealthState) => state.jobsData.jobs);
  const lastRun = useSelector((state: NavHealthState) => state.dashboard.data?.general?.lastRun);
  const attentionCount = countJobsNeedingAttention([...jobs], { lastRun });
  const healthy = attentionCount === 0;

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

  const healthSignal = () => {
    if (!primaryVisible) return null;
    const label = healthy
      ? t('nav.searchesHealthy')
      : t('nav.searchesNeedAttention', { count: String(attentionCount) });
    const className = `fredy-shell-nav__health fredy-shell-nav__health--${healthy ? 'healthy' : 'attention'}`;
    if (healthy) {
      return (
        <span className={className} role="status">
          <IconTickCircle aria-hidden="true" />
          <span className="fredy-shell-nav__health-label">{label}</span>
        </span>
      );
    }
    return (
      <button type="button" className={className} onClick={() => goTo('/jobs')} aria-label={label}>
        <IconAlertCircle aria-hidden="true" />
        <span className="fredy-shell-nav__health-label">{label}</span>
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
          {healthSignal()}
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
