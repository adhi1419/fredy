/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

import { nextTabIndex } from '../scrollspy/ScrollspyTabs';

import './SettingsRouteTabs.less';

/**
 * One entry in the settings tab rail. `path` is the route the tab links to (and the value compared
 * against the current URL to decide which tab is active); `label` is the visible text; `icon` an
 * optional leading glyph.
 */
export interface SettingsRouteTab {
  path: string;
  label: string;
  icon?: ReactNode;
}

export interface SettingsRouteTabsProps {
  /** The tabs to render, in order. */
  tabs: readonly SettingsRouteTab[];
  /** Accessible name for the tab rail. */
  ariaLabel: string;
  /** Optional class appended to the rail wrapper. */
  className?: string;
}

/**
 * Pick the active tab path for a URL. Longest matching prefix wins, so a nested page
 * (`/admin/system/details`) still marks its parent tab (`/admin/system`) current rather than
 * falling through to no selection. With no match, the first tab is the resting selection.
 *
 * Pure so it can be unit-tested without a DOM.
 */
export function activeRouteTab(pathname: string, tabPaths: readonly string[]): string | null {
  const matches = tabPaths.filter((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (matches.length > 0) {
    return matches.reduce((longest, path) => (path.length > longest.length ? path : longest));
  }
  return tabPaths[0] ?? null;
}

/**
 * The one navigation rail Account Preferences and Administration share.
 *
 * It is URL-driven rather than tab-index-driven: each tab is a real link, so every settings page is
 * something you can bookmark, reload onto and share, and the active tab is derived from the current
 * route rather than from internal state that resets on every visit. Visually it is the same
 * horizontally-scrollable pill rail as {@link ScrollspyTabs} (44px targets, active tab in the forest
 * accent role, thin scroll affordance on a phone), but where ScrollspyTabs scrolls *within* a page,
 * this one *navigates between* pages.
 *
 * Keyboard: arrow keys (and Home/End) move focus across the tabs with a roving tabindex, wrapping at
 * both ends; Enter/Space follow the focused link (the browser's native link activation). The active
 * tab carries `aria-current="page"`.
 *
 * Deliberately generic: it knows nothing about accounts or administration, only `{ path, label,
 * icon? }`, so both hosts pass their own tab list and nothing is duplicated between them.
 */
export default function SettingsRouteTabs({ tabs, ariaLabel, className }: SettingsRouteTabsProps): ReactNode {
  const location = useLocation();
  const tabPaths = tabs.map((tab) => tab.path);
  const activePath = activeRouteTab(location.pathname, tabPaths);
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const target = nextTabIndex(index, event.key, tabPaths.length);
    if (target === index) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
  };

  if (tabs.length === 0) return null;

  return (
    <nav className={`settingsRouteTabs${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const active = tab.path === activePath;
        return (
          <NavLink
            key={tab.path}
            to={tab.path}
            role="tab"
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            aria-selected={active}
            aria-current={active ? 'page' : undefined}
            tabIndex={active ? 0 : -1}
            className={`settingsRouteTabs__tab${active ? ' settingsRouteTabs__tab--active' : ''}`}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.icon != null && (
              <span className="settingsRouteTabs__icon" aria-hidden="true">
                {tab.icon}
              </span>
            )}
            <span className="settingsRouteTabs__label">{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

SettingsRouteTabs.displayName = 'SettingsRouteTabs';
