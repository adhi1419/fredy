/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

import type { ReactNode } from 'react';

export interface AvailableLanguage {
  code: string;
  semiLocale: string;
  name: string;
  flag: string;
}

export const availableLanguages: readonly AvailableLanguage[];
export const resources: Readonly<Record<string, unknown>>;
export function I18nProvider(props: { language?: string; children?: ReactNode }): ReactNode;
export function useTranslation(): (key: string, variables?: Record<string, string | number>) => string;
export function useLocale(): string;
