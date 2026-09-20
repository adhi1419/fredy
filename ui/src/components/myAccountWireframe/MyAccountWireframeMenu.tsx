/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { signOutFirebase } from '../../services/auth/firebaseAuth.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { useActions, useSelector } from '../../services/state/store.js';
import { ACCOUNT_NAV } from '../navigation/navModel.js';

import './MyAccountWireframeMenu.less';

export interface AccountIdentity {
  username?: string;
  userId?: string;
  isAdmin?: boolean;
}

interface AccountActions {
  user: {
    resetCurrentUser(): void;
  };
}

interface AccountMenuState {
  generalSettings: {
    settings?: {
      debugLoggingEnabled?: boolean;
    };
  };
}

interface MyAccountWireframeMenuProps {
  currentUser?: AccountIdentity | null;
  isAdmin?: boolean;
  primaryVisible?: boolean;
}

export function accountInitials(username: unknown): string {
  const identity = typeof username === 'string' ? username.trim() : '';
  const words = identity
    .split('@', 1)[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)?.[0] ?? ''}`.toUpperCase();
}

export function accountDisplayName(username: unknown): string {
  const identity = typeof username === 'string' ? username.trim() : '';
  const words = identity
    .split('@', 1)[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ');
}

export function menuItemIndexForKey(key: string, currentIndex: number, itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (currentIndex < 0) {
    if (key === 'ArrowDown') return 0;
    if (key === 'ArrowUp') return itemCount - 1;
  }
  if (key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  return currentIndex;
}

export function accountDestinationPaths(isAdmin: boolean, primaryVisible: boolean): string[] {
  if (!primaryVisible) return [];
  return ACCOUNT_NAV.filter((item) => !item.adminOnly || isAdmin).map((item) => item.path);
}

export default function MyAccountWireframeMenu({
  currentUser,
  isAdmin = false,
  primaryVisible = true,
}: MyAccountWireframeMenuProps): ReactNode {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useActions<AccountActions>();
  const debugLoggingEnabled = useSelector<AccountMenuState, boolean>(
    (state) => state.generalSettings.settings?.debugLoggingEnabled === true,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const previousPathRef = useRef(location.pathname);
  const [accountOpen, setAccountOpen] = useState(false);

  const closeAccountMenu = useCallback((restoreFocus = false) => {
    setAccountOpen(false);
    if (restoreFocus) accountButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const pathChanged = previousPathRef.current !== location.pathname;
    previousPathRef.current = location.pathname;
    if (pathChanged) setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!accountOpen) return undefined;
    accountMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeAccountMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [accountOpen, closeAccountMenu]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAccountMenu(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const menuItems = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const nextIndex = menuItemIndexForKey(
      event.key,
      menuItems.indexOf(document.activeElement as HTMLButtonElement),
      menuItems.length,
    );
    if (nextIndex >= 0) menuItems[nextIndex]?.focus();
  };

  const goTo = (path: string) => {
    closeAccountMenu();
    navigate(path);
  };

  const handleSignOut = async () => {
    closeAccountMenu();
    try {
      await signOutFirebase();
    } finally {
      actions.user.resetCurrentUser();
      navigate('/login', { replace: true });
    }
  };

  const accountItems = useMemo(
    () => (primaryVisible ? ACCOUNT_NAV.filter((item) => !item.adminOnly || isAdmin) : []),
    [isAdmin, primaryVisible],
  );
  const username = currentUser?.username ?? '';
  const displayName = accountDisplayName(username) || username;

  return (
    <div ref={containerRef} className="myAccountWireframeMenu">
      <button
        type="button"
        ref={accountButtonRef}
        className="fredy-shell-nav__account-button"
        aria-label={t('nav.openAccountMenu')}
        aria-haspopup="menu"
        aria-expanded={accountOpen}
        onClick={() => setAccountOpen((open) => !open)}
      >
        <span className="fredy-shell-nav__account-avatar" aria-hidden="true">
          {accountInitials(username)}
        </span>
        <span className="fredy-shell-nav__account-label">{t('nav.account')}</span>
      </button>
      {accountOpen && (
        <div
          ref={accountMenuRef}
          className="myAccountWireframeMenu__menu"
          role="menu"
          aria-label={t('nav.accountMenu')}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="myAccountWireframeMenu__head">
            <strong>{displayName}</strong>
            <span>{username}</span>
            <span>{t(isAdmin ? 'nav.roleAdministrator' : 'nav.roleUser')}</span>
          </div>
          {accountItems.length > 0 && (
            <div className="myAccountWireframeMenu__group">
              {accountItems.map((item) => (
                <button key={item.key} type="button" role="menuitem" onClick={() => goTo(item.path)}>
                  <span>{t(item.labelKey)}</span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          )}
          <div className="myAccountWireframeMenu__group">
            <button type="button" role="menuitem" className="myAccountWireframeMenu__signOut" onClick={handleSignOut}>
              <span>{t('nav.signOut')}</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          {debugLoggingEnabled && (
            <div className="myAccountWireframeMenu__criticalNote" role="status">
              <strong>{t('nav.criticalState')}</strong>
              <span>{t('nav.debugCaptureActive')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

MyAccountWireframeMenu.displayName = 'MyAccountWireframeMenu';
