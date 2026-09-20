/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The product shell has exactly two primary destinations. Route families are kept here rather than
 * in the component so deep links can highlight the right tab without changing or redirecting the
 * existing page routes.
 */
export interface PrimaryDestination {
  key: 'home' | 'saved-searches';
  path: string;
  labelKey: string;
  routePrefixes: readonly string[];
}

export const PRIMARY_NAV: readonly PrimaryDestination[] = [
  {
    key: 'home',
    path: '/dashboard',
    labelKey: 'nav.home',
    routePrefixes: ['/dashboard', '/listings', '/map', '/finance'],
  },
  {
    key: 'saved-searches',
    path: '/jobs',
    labelKey: 'nav.savedSearches',
    routePrefixes: ['/jobs'],
  },
];

export interface AccountDestination {
  key: 'account' | 'admin';
  path: string;
  labelKey: string;
  adminOnly?: boolean;
}

export const ACCOUNT_NAV: readonly AccountDestination[] = [
  { key: 'account', path: '/settings', labelKey: 'nav.myAccount' },
  { key: 'admin', path: '/admin', labelKey: 'nav.adminPanel', adminOnly: true },
];

/**
 * Returns the primary destination that owns a pathname. Settings and admin deliberately return
 * null: they are reachable from the account control but must not compete with the two tabs.
 *
 * @param pathname
 * @returns
 */
export function resolvePrimaryKey(pathname: string): 'home' | 'saved-searches' | null {
  const path = pathname.split(/[?#]/, 1)[0];
  const match = PRIMARY_NAV.find(({ routePrefixes }) =>
    routePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );
  if (match) {
    return match.key;
  }
  return null;
}

/**
 * Compatibility model for code and tests that need to inspect all shell destinations.
 */
export interface NavNode {
  key: string;
  labelKey: string;
  path?: string;
  adminOnly?: boolean;
}

export const NAV_TREE: readonly NavNode[] = [
  ...PRIMARY_NAV.map(({ path, labelKey }) => ({ key: path, labelKey })),
  ...ACCOUNT_NAV,
];

export function navTreeFor(isAdmin: boolean): readonly NavNode[] {
  return NAV_TREE.filter((node) => !node.adminOnly || isAdmin);
}

export function routeKeysOf(tree: readonly NavNode[]): readonly string[] {
  return tree
    .map((node) => (node.key.startsWith('/') ? node.key : node.path))
    .filter((path): path is string => typeof path === 'string' && path.startsWith('/'));
}

/**
 * Resolve the old route-key shape for callers that still need it. Primary deep links resolve to the
 * root route for their family; settings/admin stay individually addressable.
 *
 * @param tree
 * @param pathname
 * @returns
 */
export function resolveActiveKey(tree: readonly NavNode[], pathname: string): string {
  const primary = resolvePrimaryKey(pathname);
  if (primary !== null) {
    const navItem = PRIMARY_NAV.find((item) => item.key === primary);
    if (navItem) return navItem.path;
  }
  const route = routeKeysOf(tree).find((key) => pathname === key || pathname.startsWith(`${key}/`));
  if (route) {
    return route;
  }
  return `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
}
