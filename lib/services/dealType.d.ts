/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export type DealType = 'rent' | 'buy';

export const DEAL_TYPES: Readonly<{
  RENT: 'rent';
  BUY: 'buy';
}>;

export function normalizeDealType(value: unknown): DealType | null;

export function detectDealTypeFromUrl(url: unknown): DealType | null;

export function detectDealTypeForJob(providerEntries: Array<{ url?: string }> | null | undefined): DealType | null;

export function dealTypeForPrice(price: unknown, threshold: number): DealType | null;
