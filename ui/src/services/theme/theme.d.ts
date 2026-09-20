/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

export type Theme = 'dark' | 'light';
export const THEMES: readonly Theme[];
export const DEFAULT_THEME: Theme;
export function normalizeTheme(value: unknown): Theme;
export function currentTheme(): Theme;
export function applyTheme(theme: unknown): Theme;
