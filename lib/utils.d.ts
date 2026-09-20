/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/* Copyright (c) 2026 by Christian Kellner. */

/** A provider's identifying metadata, as normalized by {@link getProviders}. */
export interface ProviderMetaInformation {
  id: string;
  name: string;
  baseUrl?: string;
  /** ISO 3166-1 alpha-2 codes (lowercase); absent means Germany only. */
  countries?: string[];
}

/** A loaded provider plugin module. */
export interface ProviderModule {
  metaInformation: ProviderMetaInformation;
  [key: string]: unknown;
}

/** Lazily load all provider plugin modules, caching the result. */
export function getProviders(): Promise<ProviderModule[]>;
