/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * The product shell has exactly two primary destinations. Route families are kept here rather than
 * in the component so deep links can highlight the right tab without changing or redirecting the
 * existing page routes.
 *
 * @typedef {{ key: 'home'|'saved-searches', path: string, labelKey: string, routePrefixes: string[] }} PrimaryDestination
 */

/** @type {PrimaryDestination[]} */
export const PRIMARY_NAV = [
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

/** @type {{ key: 'account'|'admin', path: string, labelKey: string, adminOnly?: boolean }[]} */
export const ACCOUNT_NAV = [
  { key: 'account', path: '/settings', labelKey: 'nav.myAccount' },
  { key: 'admin', path: '/admin', labelKey: 'nav.adminPanel', adminOnly: true },
];

/**
 * Returns the primary destination that owns a pathname. Settings and admin deliberately return
 * null: they are reachable from the account control but must not compete with the two tabs.
 *
 * @param {string} pathname
 * @returns {'home'|'saved-searches'|null}
 */
export function resolvePrimaryKey(pathname) {
  const path = pathname.split(/[?#]/, 1)[0];
  return (
    PRIMARY_NAV.find(({ routePrefixes }) =>
      routePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    )?.key ?? null
  );
}

/**
 * Compatibility model for code and tests that need to inspect all shell destinations.
 *
 * @typedef {Object} NavNode
 * @property {string} key
 * @property {string} labelKey
 * @property {string} [path]
 * @property {boolean} [adminOnly]
 */
export const NAV_TREE = [...PRIMARY_NAV.map(({ path, labelKey }) => ({ key: path, labelKey })), ...ACCOUNT_NAV];

/** @param {boolean} isAdmin @returns {NavNode[]} */
export function navTreeFor(isAdmin) {
  return NAV_TREE.filter((node) => !node.adminOnly || isAdmin);
}

/** @param {NavNode[]} tree @returns {string[]} */
export function routeKeysOf(tree) {
  return tree
    .map((node) => (node.key.startsWith('/') ? node.key : node.path))
    .filter((path) => typeof path === 'string' && path.startsWith('/'));
}

/**
 * Resolve the old route-key shape for callers that still need it. Primary deep links resolve to the
 * root route for their family; settings/admin stay individually addressable.
 *
 * @param {NavNode[]} tree
 * @param {string} pathname
 * @returns {string}
 */
export function resolveActiveKey(tree, pathname) {
  const primary = resolvePrimaryKey(pathname);
  if (primary) return PRIMARY_NAV.find((item) => item.key === primary).path;
  const route = routeKeysOf(tree).find((key) => pathname === key || pathname.startsWith(`${key}/`));
  return route ?? `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
}
