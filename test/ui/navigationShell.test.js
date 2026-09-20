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
      'nav.savedSearches': 'Saved Searches',
      'nav.signOut': 'Sign out',
    })[key] ?? key,
}));

import Navigation from '../../ui/src/components/navigation/Navigation.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const styles = fs.readFileSync(path.join(here, '../../ui/src/components/navigation/Navigate.less'), 'utf8');

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
