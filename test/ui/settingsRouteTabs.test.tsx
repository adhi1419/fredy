/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import SettingsRouteTabs, { activeRouteTab } from '../../ui/src/components/settingsRouteTabs/SettingsRouteTabs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const componentSource = read('ui/src/components/settingsRouteTabs/SettingsRouteTabs.tsx');
const styles = read('ui/src/components/settingsRouteTabs/SettingsRouteTabs.less');
const settingsLayoutSource = read('ui/src/views/settings/SettingsLayout.tsx');
const settingsShellSource = read('ui/src/components/settingsShell/SettingsShell.tsx');

const paths = ['/settings/preferences', '/settings/travel-time', '/settings/notifications'];

function render(pathname: string, tabs = paths.map((p) => ({ path: p, label: p }))): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <SettingsRouteTabs tabs={tabs} ariaLabel="Settings" />
    </MemoryRouter>,
  );
}

describe('activeRouteTab resolver', () => {
  it('matches an exact path', () => {
    expect(activeRouteTab('/settings/travel-time', paths)).toBe('/settings/travel-time');
  });

  it('marks a nested page against its parent tab (longest prefix wins)', () => {
    expect(activeRouteTab('/settings/travel-time/details', paths)).toBe('/settings/travel-time');
    expect(activeRouteTab('/admin/system/logs', ['/admin/system', '/admin/system/logs'])).toBe('/admin/system/logs');
  });

  it('does not treat a sibling sharing a string prefix as nested', () => {
    // '/admin/systemic' must not match '/admin/system' - the boundary is a slash.
    expect(activeRouteTab('/admin/systemic', ['/admin/system', '/admin/execution'])).toBe('/admin/system');
    // (falls back to first because neither is a real prefix match)
  });

  it('falls back to the first tab when nothing matches, and null with no tabs', () => {
    expect(activeRouteTab('/somewhere/else', paths)).toBe('/settings/preferences');
    expect(activeRouteTab('/x', [])).toBeNull();
  });
});

describe('SettingsRouteTabs rendering', () => {
  it('renders each tab as a real link and marks the active one current', () => {
    const html = render('/settings/notifications');
    expect(html).toContain('href="/settings/notifications"');
    expect(html).toContain('href="/settings/preferences"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/settings\/notifications"/);
    // Exactly one tab is current.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('exposes tablist/tab semantics and a roving tabindex', () => {
    const html = render('/settings/preferences');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-label="Settings"');
    // The active tab is the only one reachable by Tab; arrows move within the rail.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('tabindex="-1"');
  });

  it('renders nothing for an empty tab list', () => {
    expect(render('/settings/preferences', [])).toBe('');
  });
});

describe('SettingsRouteTabs source contract', () => {
  it('is URL-driven and generic - no host coupling', () => {
    expect(componentSource).toContain('export interface SettingsRouteTab');
    expect(componentSource).toContain('tabs: readonly SettingsRouteTab[]');
    expect(componentSource).toContain('useLocation');
    // Reuses the shared keyboard helper rather than duplicating arrow-key logic.
    expect(componentSource).toContain("import { nextTabIndex } from '../scrollspy/ScrollspyTabs'");
    // Never imports a host (views / admin / settings pages).
    expect(componentSource).not.toMatch(/from '\.\.\/\.\.\/(views|services\/jobs)\//);
  });

  it('handles keyboard focus movement and aria-current', () => {
    expect(componentSource).toContain('role="tablist"');
    expect(componentSource).toContain('role="tab"');
    expect(componentSource).toContain("aria-current={active ? 'page' : undefined}");
    expect(componentSource).toContain('tabIndex={active ? 0 : -1}');
    expect(componentSource).toContain('onKeyDown');
    expect(componentSource).toContain('.focus()');
  });

  it('is a horizontally scrollable pill rail with 44px targets and no colour literals', () => {
    expect(styles).toMatch(/\.settingsRouteTabs\s*{[\s\S]*?overflow-x:\s*auto;/);
    expect(styles).toMatch(/&__tab\s*{[\s\S]*?min-height:\s*44px;/);
    expect(styles).toMatch(/&__tab\s*{[\s\S]*?border-radius:\s*@radius-pill;/);
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('both settings areas reuse the one rail', () => {
  it('Account Preferences and Administration both drive SettingsRouteTabs and duplicate no rail', () => {
    expect(settingsLayoutSource).toContain('SettingsRouteTabs');
    expect(settingsShellSource).toContain('SettingsRouteTabs');
    // Neither hand-rolls its own NavLink rail or Semi Tabs any more.
    expect(settingsLayoutSource).not.toContain('<NavLink');
    expect(settingsShellSource).not.toContain('<Tabs');
    // Admin keeps its banner and outlet context.
    expect(settingsShellSource).toContain('{banner}');
    expect(settingsShellSource).toContain('<Outlet context={context} />');
  });
});
