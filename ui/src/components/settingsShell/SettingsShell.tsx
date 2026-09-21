/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Outlet } from 'react-router';
import type { ReactNode } from 'react';

import Headline from '../headline/Headline.jsx';
import SettingsRouteTabs, { type SettingsRouteTab } from '../settingsRouteTabs/SettingsRouteTabs.jsx';

import './SettingsShell.less';

/**
 * The frame both settings areas share: a heading, a strip of sub-pages, and whatever the current
 * sub-route renders.
 *
 * The strip is driven by the URL rather than by internal tab state. That is the whole point of the
 * restructure: every settings page is a place you can link to, bookmark and reload onto, instead of
 * a tab index that resets to the first pane on every visit. Administration renders through this
 * shell; Account Preferences renders the same {@link SettingsRouteTabs} rail directly. Both use the
 * one shared rail so the two areas navigate identically - only the tab list and the optional banner
 * differ.
 */
export interface SettingsShellTab {
  path: string;
  label: string;
  icon?: ReactNode;
}

export interface SettingsShellProps {
  /** Page heading. */
  title: string;
  /** Sub-pages, in order. */
  tabs: SettingsShellTab[];
  /**
   * Rendered between the heading and the strip. Administration uses it for the scope band; the
   * personal pages deliberately have none.
   */
  banner?: ReactNode;
  /** Passed to the sub-route through `useOutletContext()`. */
  context?: unknown;
}

export default function SettingsShell({ title, tabs, banner = null, context = undefined }: SettingsShellProps) {
  // SettingsShellTab and SettingsRouteTab are the same shape; the alias keeps each area's public
  // type stable while both feed the one shared rail.
  const routeTabs: SettingsRouteTab[] = tabs.map((tab) => ({ path: tab.path, label: tab.label, icon: tab.icon }));

  return (
    <div className="settingsShell">
      <Headline text={title} />
      {banner}
      <SettingsRouteTabs tabs={routeTabs} ariaLabel={title} className="settingsShell__nav" />
      <div className="settingsShell__content">
        <Outlet context={context} />
      </div>
    </div>
  );
}

SettingsShell.displayName = 'SettingsShell';
