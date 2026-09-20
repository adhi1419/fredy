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
import { describe, expect, it, vi } from 'vitest';

interface MockState {
  generalSettings: { settings: { debugLoggingEnabled: boolean } };
}

vi.mock('../../ui/src/services/state/store.js', () => ({
  useActions: () => ({ user: { resetCurrentUser: vi.fn() } }),
  useSelector: (selector: (state: MockState) => unknown) =>
    selector({ generalSettings: { settings: { debugLoggingEnabled: false } } }),
}));

vi.mock('@douyinfe/semi-icons', async () => {
  const { createElement } = await import('react');
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement('svg', { ...props, 'data-icon': name });
  return {
    IconBell: icon('bell'),
    IconEdit: icon('edit'),
    IconHome: icon('home'),
    IconListView: icon('list'),
    IconMapPin: icon('map-pin'),
    IconSearch: icon('search'),
  };
});

vi.mock('../../ui/src/services/auth/firebaseAuth.js', () => ({
  signOutFirebase: vi.fn(),
  safePhotoUrl: (value: unknown) => {
    if (typeof value !== 'string') return null;
    try {
      return new URL(value).protocol === 'https:' ? value : null;
    } catch {
      return null;
    }
  },
}));

vi.mock('../../ui/src/services/i18n/i18n.jsx', () => ({
  useTranslation: () => (key: string) => key,
}));

import Navigation from '../../ui/src/components/navigation/Navigation.js';
import {
  accountDestinationPaths,
  accountDisplayName,
  accountInitials,
  menuItemIndexForKey,
} from '../../ui/src/components/myAccountWireframe/MyAccountWireframeMenu.js';
import SettingsLayout, {
  PERSONAL_SETTINGS_SECTIONS,
  personalSettingsSectionFor,
} from '../../ui/src/views/settings/SettingsLayout.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const navigationStyles = read('ui/src/components/navigation/Navigate.less');
const menuStyles = read('ui/src/components/myAccountWireframe/MyAccountWireframeMenu.less');
const settingsStyles = read('ui/src/views/settings/SettingsLayout.less');
const appSource = read('ui/src/App.tsx');
const menuSource = read('ui/src/components/myAccountWireframe/MyAccountWireframeMenu.tsx');
const settingsSource = read('ui/src/views/settings/SettingsLayout.tsx');
const adminSource = read('ui/src/views/admin/AdminLayout.jsx');

function renderNavigation(pathname: string, primaryVisible = true, photoUrl: string | null = null): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <Navigation
        currentUser={{ username: 'alex.rivera@example.com', isAdmin: true }}
        isAdmin
        photoUrl={photoUrl}
        primaryVisible={primaryVisible}
      />
    </MemoryRouter>,
  );
}

function renderSettings(pathname: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <SettingsLayout />
    </MemoryRouter>,
  );
}

describe('two-destination product shell', () => {
  it('uses the Firebase identity for a colored initials account trigger', () => {
    const html = renderNavigation('/jobs');
    expect(accountInitials('alex.rivera@example.com')).toBe('AR');
    expect(accountInitials('adhitr')).toBe('AD');
    expect(accountDisplayName('alex.rivera@example.com')).toBe('Alex Rivera');
    expect(html).toContain('fredy-shell-nav__account-avatar');
    expect(html).toContain('>AR</span>');
    expect(navigationStyles).toMatch(/\.fredy-shell-nav__account-button\s*{[^}]*min-height:\s*44px/s);
  });

  it('keeps the account trigger icon-only while preserving an accessible label', () => {
    const html = renderNavigation('/jobs');
    // Direction A: the trigger is icon-only, so the visible "Account" label span is gone.
    expect(html).not.toContain('fredy-shell-nav__account-label');
    expect(navigationStyles).not.toContain('fredy-shell-nav__account-label');
    // The button keeps its accessible name via aria-label rather than visible text.
    expect(html).toMatch(/aria-label="nav\.openAccountMenu"/);
  });

  it('renders the Firebase profile photo with no-referrer and keeps initials as the fallback', () => {
    const photo = 'https://lh3.googleusercontent.com/a/avatar=s96-c';
    const html = renderNavigation('/jobs', true, photo);
    expect(html).toContain('fredy-shell-nav__account-photo');
    expect(html).toContain(photo);
    expect(html).toMatch(/referrerpolicy="no-referrer"/i);
    // Initials remain in the DOM underneath the photo as the fallback layer.
    expect(html).toContain('>AR</span>');
    // Object-fit cover, rounding, and a 44px-reachable trigger are guaranteed by CSS.
    expect(navigationStyles).toMatch(/\.fredy-shell-nav__account-photo\s*{[^}]*object-fit:\s*cover/s);
    expect(navigationStyles).toMatch(/\.fredy-shell-nav__account-photo\s*{[^}]*border-radius:\s*50%/s);
  });

  it('falls back to initials for a missing or unsafe photo URL', () => {
    for (const unsafe of [null, 'http://insecure.example/a.png', 'javascript:alert(1)', 'not a url']) {
      const html = renderNavigation('/jobs', true, unsafe as string | null);
      expect(html).not.toContain('fredy-shell-nav__account-photo');
      expect(html).toContain('>AR</span>');
    }
  });

  it('keeps exactly one personal destination and makes Administration conditional', () => {
    expect(accountDestinationPaths(false, true)).toEqual(['/settings']);
    expect(accountDestinationPaths(true, true)).toEqual(['/settings', '/admin']);
    expect(accountDestinationPaths(true, false)).toEqual([]);
  });

  it('renders an account-only shell during mandatory onboarding', () => {
    const html = renderNavigation('/onboarding/applicant-profile', false);
    expect(html).not.toContain('fredy-shell-nav__primary-link');
    expect(html).not.toContain('fredy-shell-nav__mobile-primary');
    expect(html).toContain('fredy-shell-nav__account-button');
  });

  it.each(['/settings/preferences', '/admin/system'])('leaves product tabs unselected on %s', (pathname) => {
    expect(renderNavigation(pathname)).not.toContain('is-active');
  });
});

describe('account menu accessibility contracts', () => {
  it('wraps menu movement and handles Home/End boundaries', () => {
    expect(menuItemIndexForKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuItemIndexForKey('ArrowUp', 0, 3)).toBe(2);
    expect(menuItemIndexForKey('ArrowUp', -1, 3)).toBe(2);
    expect(menuItemIndexForKey('ArrowDown', -1, 3)).toBe(0);
    expect(menuItemIndexForKey('Home', 2, 3)).toBe(0);
    expect(menuItemIndexForKey('End', 0, 3)).toBe(2);
    expect(menuItemIndexForKey('PageDown', 1, 3)).toBe(1);
    expect(menuItemIndexForKey('ArrowDown', 0, 0)).toBe(-1);
  });

  it('keeps one Escape owner, outside close, route close, focus restoration, and Firebase signout', () => {
    expect(menuSource).toContain("event.key === 'Escape'");
    expect(menuSource).toContain('closeAccountMenu(true)');
    expect(menuSource).toContain("document.addEventListener('pointerdown'");
    expect(menuSource).not.toContain("document.addEventListener('keydown'");
    expect(menuSource).toContain('previousPathRef.current !== location.pathname');
    expect(menuSource).toContain('await signOutFirebase()');
    expect(menuSource).toContain('actions.user.resetCurrentUser()');
  });

  it('opens below the top header and keeps every interactive target reachable', () => {
    expect(menuStyles).toContain('top: calc(100% + @space-2)');
    expect(menuStyles).not.toContain('bottom: calc(100%');
    expect(menuStyles).toMatch(/button\s*{[^}]*min-height:\s*44px/s);
    expect(menuStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('cohesive My account destination', () => {
  it('preserves every deep personal route and resolves its active section', () => {
    expect(PERSONAL_SETTINGS_SECTIONS.map(({ path }) => path)).toEqual([
      '/settings/preferences',
      '/settings/travel-time',
      '/settings/listings',
      '/settings/notifications',
      '/settings/inquiry-profile',
    ]);
    expect(personalSettingsSectionFor('/settings/notifications')).toBe('/settings/notifications');
    expect(personalSettingsSectionFor('/settings/travel-time/details')).toBe('/settings/travel-time');
    expect(personalSettingsSectionFor('/settings')).toBe('/settings/preferences');
  });

  it('renders state-preserving links and marks the direct deep link current', () => {
    const html = renderSettings('/settings/notifications');
    expect(html).toContain('href="/settings/notifications"');
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/settings\/notifications"/);
    expect(settingsSource).toContain('<NavLink');
    expect(settingsSource).not.toContain('<Tabs');
    expect(settingsSource).not.toContain('SettingsShell');
  });

  it('uses a compact local heading and keeps Admin on its guarded shared shell', () => {
    expect(settingsSource).toContain('className="settingsLayout__heading"');
    expect(settingsSource).not.toContain('Headline');
    expect(adminSource).toContain('SettingsShell');
    expect(appSource).toContain('path="/settings"');
    expect(appSource).toContain('path="/admin"');
  });

  it('keeps mobile navigation contained above fixed primary navigation', () => {
    expect(settingsStyles).toContain('@media (max-width: 768px)');
    expect(settingsStyles).toContain('overflow-x: auto');
    expect(settingsStyles).toContain('env(safe-area-inset-bottom)');
    expect(settingsStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe('strict migration and shell landmarks', () => {
  it('targets the existing focus landmark and preserves Home query navigation', () => {
    expect(appSource).toContain('id="fredy-main-content" tabIndex={-1}');
    expect(read('ui/src/components/navigation/Navigation.tsx')).toContain(
      'homeSearchForNavigation(location.pathname, location.search)',
    );
  });

  it('deletes the touched JSX/JS counterparts', () => {
    expect(fs.existsSync(path.join(root, 'ui/src/App.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/components/navigation/Navigation.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/SettingsLayout.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/navigationShell.test.js'))).toBe(false);
  });
});
