/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export interface PrimaryDestination {
  key: 'home' | 'saved-searches';
  path: string;
  labelKey: string;
  routePrefixes: readonly string[];
}

export interface AccountDestination {
  key: 'account' | 'admin';
  path: string;
  labelKey: string;
  adminOnly?: boolean;
}

export const PRIMARY_NAV: readonly PrimaryDestination[];
export const ACCOUNT_NAV: readonly AccountDestination[];
export function resolvePrimaryKey(pathname: string): PrimaryDestination['key'] | null;
