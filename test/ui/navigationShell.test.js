/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/src/services/state/store.js', () => ({
  useActions: () => ({ user: { resetCurrentUser: vi.fn() } }),
}));

vi.mock('@douyinfe/semi-icons', async () => {
  const { createElement } = await import('react');
  const icon = (name) => (props) => createElement('svg', { ...props, 'data-icon': name });
  return {
    IconHome: icon('home'),
    IconSearch: icon('search'),
    IconUser: icon('user'),
  };
});

vi.mock('../../ui/src/services/auth/firebaseAuth.js', () => ({
  signOutFirebase: vi.fn(),
}));

vi.mock('../../ui/src/services/i18n/i18n.jsx', () => ({
  useTranslation: () => (key) =>
    ({
      'nav.account': 'Account',
      'nav.accountMenu': 'Account menu',
      'nav.adminPanel': 'Admin panel',
      'nav.home': 'Home',
      'nav.myAccount': 'My account',
      'nav.openAccountMenu': 'Open account menu',
      'nav.primary': 'Primary navigation',
      'nav.skipToContent': 'Skip to content',
      'nav.savedSearches': 'Saved Searches',
      'nav.signOut': 'Sign out',
    })[key] ?? key,
}));

import Navigation, { menuItemIndexForKey } from '../../ui/src/components/navigation/Navigation.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.join(here, '../../ui/src/components/navigation/Navigate.less'), 'utf8');
const appSource = fs.readFileSync(path.join(here, '../../ui/src/App.jsx'), 'utf8');

function renderNavigation(pathname, props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      React.createElement(Navigation, { isAdmin: true, ...props }),
    ),
  );
}

describe('two-tab shell component', () => {
  it('keeps the mobile account icon separate from the label-only hiding hook', () => {
    const html = renderNavigation('/jobs');
    const accountButton = html.match(/<button[^>]*class="fredy-shell-nav__account-button"[\s\S]*?<\/button>/)?.[0];

    expect(accountButton).toContain('<svg');
    expect(accountButton).toContain('fredy-shell-nav__account-label');
    expect(accountButton).toContain('Account');
    expect(styles).toContain('.fredy-shell-nav__account-label');
    expect(styles).not.toMatch(/\.fredy-shell-nav__account-button\s+span/);
    expect(styles).toMatch(/\.fredy-shell-nav__account-button\s*{[^}]*min-width:\s*44px/s);
  });

  it('renders an account-only shell during mandatory onboarding', () => {
    const html = renderNavigation('/onboarding/applicant-profile', { primaryVisible: false });

    expect(html).not.toContain('fredy-shell-nav__primary-link');
    expect(html).not.toContain('fredy-shell-nav__mobile-primary');
    expect(html).toContain('fredy-shell-nav__account-button');
  });

  it.each(['/settings/preferences', '/admin/system'])('leaves both primary tabs unselected on %s', (pathname) => {
    expect(renderNavigation(pathname)).not.toContain('is-active');
  });
});

describe('accessibility shell contracts', () => {
  it('places one skip link before navigation and targets the existing Content landmark', () => {
    const html = renderNavigation('/dashboard');

    expect(html.indexOf('fredy-shell-skip-link')).toBeLessThan(html.indexOf('fredy-shell-nav'));
    expect(html).toContain('href="#fredy-main-content"');
    expect(appSource).toContain('<Content className="app__content" id="fredy-main-content" tabIndex="-1">');
    expect(appSource.match(/<main\b/g) ?? []).toHaveLength(0);
    expect(styles).toMatch(/\.fredy-shell-skip-link\s*{[^}]*background:\s*@color-elevated/s);
    expect(styles).toMatch(/\.fredy-shell-skip-link\s*{[^}]*color:\s*@color-text/s);
    expect(styles).toMatch(/\.fredy-shell-skip-link\s*{[^}]*transform:\s*translateY\(-200%\)/s);
    expect(styles).toContain('&:focus-visible');
  });

  it('wraps Account menu movement and handles Home/End boundaries', () => {
    expect(menuItemIndexForKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuItemIndexForKey('ArrowUp', 0, 3)).toBe(2);
    expect(menuItemIndexForKey('ArrowUp', -1, 3)).toBe(2);
    expect(menuItemIndexForKey('ArrowDown', -1, 3)).toBe(0);
    expect(menuItemIndexForKey('Home', 2, 3)).toBe(0);
    expect(menuItemIndexForKey('End', 0, 3)).toBe(2);
    expect(menuItemIndexForKey('PageDown', 1, 3)).toBe(1);
    expect(menuItemIndexForKey('ArrowDown', 0, 0)).toBe(-1);
  });

  it('keeps menu focus and close behavior wired in the component', () => {
    const navigationSource = fs.readFileSync(
      path.join(here, '../../ui/src/components/navigation/Navigation.jsx'),
      'utf8',
    );

    expect(navigationSource).toContain("document.getElementById('fredy-main-content')?.focus()");
    expect(navigationSource).toContain('event.preventDefault()');
    expect(navigationSource).toContain('onClick={focusMainContent}');
    expect(navigationSource).toContain('accountMenuRef.current?.querySelector(\'[role="menuitem"]\')?.focus()');
    expect(navigationSource).toContain('accountMenuRef.current?.querySelectorAll(\'[role="menuitem"]\')');
    expect(navigationSource).toContain('onKeyDown={handleAccountMenuKeyDown}');
    expect(navigationSource).toContain("event.key === 'Escape'");
    expect(navigationSource).toContain('closeAccountMenu(true)');
    expect(navigationSource).toContain("document.addEventListener('pointerdown'");
    expect(navigationSource).toContain('useEffect(() => {\n    closeAccountMenu();');
  });
});
