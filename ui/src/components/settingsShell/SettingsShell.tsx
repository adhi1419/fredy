/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Tabs } from '@douyinfe/semi-ui-19';
import { Outlet, useLocation, useNavigate } from 'react-router';
import type { ReactNode } from 'react';

import Headline from '../headline/Headline.jsx';

import './SettingsShell.less';

/**
 * The frame both settings areas share: a heading, a strip of sub-pages, and whatever the current
 * sub-route renders.
 *
 * The strip is driven by the URL rather than by internal tab state. That is the whole point of the
 * restructure: every settings page is a place you can link to, bookmark and reload onto, instead of
 * a tab index that resets to the first pane on every visit.
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
  const navigate = useNavigate();
  const location = useLocation();

  // Longest prefix wins, so nested Administration pages still mark their parent tab as current
  // instead of falling through to no selection at all.
  const activeKey =
    tabs
      .map((tab) => tab.path)
      .filter((path) => location.pathname === path || location.pathname.startsWith(path + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? tabs[0]?.path;

  return (
    <div className="settingsShell">
      <Headline text={title} />
      {banner}
      <Tabs
        type="line"
        tabPaneMotion={false}
        activeKey={activeKey}
        tabBarClassName="settingsShell__tabbar"
        onTabClick={(key) => {
          if (key !== activeKey) {
            navigate(key);
          }
        }}
        tabList={tabs.map((tab) => ({ itemKey: tab.path, tab: tab.label, icon: tab.icon }))}
      />
      <div className="settingsShell__content">
        <Outlet context={context} />
      </div>
    </div>
  );
}

SettingsShell.displayName = 'SettingsShell';
