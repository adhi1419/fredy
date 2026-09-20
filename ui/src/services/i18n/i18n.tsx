/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

type LocaleMeta = {
  flag?: string;
  name?: string;
  locale?: string;
  semiLocale?: string | null;
};

type LocaleFile = { _meta?: LocaleMeta } & Record<string, unknown>;
type LocaleModule = { default?: LocaleFile } & Partial<LocaleFile>;

// Auto-discover all locale JSON files at build time
const localeModules = import.meta.glob<LocaleModule>('../../locales/*.json', { eager: true });

export interface AvailableLanguage {
  code: string;
  flag: string;
  name: string;
  locale: string;
  semiLocale: string | null;
}

/**
 * Build resources object: { en: {...translations}, de: {...translations}, ... }
 * Strips _meta from each locale file.
 */
const resources: Record<string, Record<string, string>> = {};

/**
 * Build availableLanguages array: [{ code, flag, name, locale }, ...]
 * Uses _meta from each locale file with fallbacks.
 */
const availableLanguages: AvailableLanguage[] = [];

/** Maps language code to BCP 47 locale string (e.g. 'de' → 'de-DE') */
const localeMap: Record<string, string> = {};

for (const [path, module] of Object.entries(localeModules)) {
  // Extract locale code from path: '../../locales/en.json' -> 'en'
  const match = path.match(/\/(\w+)\.json$/);
  if (!match) continue;

  const code = match[1];
  const localeData: LocaleFile = module.default ?? (module as LocaleFile);

  // Extract _meta and build resources
  const { _meta, ...translations } = localeData;
  resources[code] = translations as Record<string, string>;

  // Build availableLanguages entry
  const flag = _meta?.flag || '';
  const name = _meta?.name || code;
  const locale = _meta?.locale || code;
  const semiLocale = _meta?.semiLocale ?? null;
  localeMap[code] = locale;
  availableLanguages.push({ code, flag, name, locale, semiLocale });
}

if (availableLanguages.length === 0) {
  console.warn('i18n: No locale files found in locales/');
}
if (!resources.en) {
  console.error('i18n: English locale (en.json) is required as the fallback language');
}

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export interface TranslationContextValue {
  t: TranslateFn;
  locale: string;
}

/**
 * Translation context
 */
const TranslationContext = createContext<TranslationContextValue | null>(null);

/**
 * I18nProvider component
 * Accepts a language prop and provides a t() function via context.
 * Falls back to English, then to key itself if translation missing.
 * Supports {{varName}} interpolation.
 */
export function I18nProvider({ language = 'en', children }: { language?: string; children?: ReactNode }) {
  /**
   * Translate a key with optional variable interpolation
   */
  const t: TranslateFn = (key, vars = {}) => {
    // Try active language
    let translation = resources[language]?.[key];

    // Fallback to English
    if (!translation) {
      translation = resources.en?.[key];
    }

    // Fallback to key itself
    if (!translation) {
      translation = key;
    }

    // Interpolate variables: replace {{varName}} with values
    if (vars && Object.keys(vars).length > 0) {
      translation = translation.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
        return vars[varName] !== undefined ? String(vars[varName]) : match;
      });
    }

    return translation;
  };

  const locale = localeMap[language] ?? localeMap.en ?? 'en-US';
  const value = useMemo<TranslationContextValue>(() => ({ t, locale }), [language]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

/**
 * Hook to access the translation function from context.
 */
export function useTranslation(): TranslateFn {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context.t;
}

/**
 * Hook to access the active BCP 47 locale string (e.g. 'de-DE', 'en-US').
 * Use this with Intl APIs for locale-aware date/number formatting.
 */
export function useLocale(): string {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useLocale must be used within an I18nProvider');
  }
  return context.locale;
}

// Export resources and availableLanguages for other uses
export { resources, availableLanguages };
