/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** The parsed mode and ceiling encoded by a commute URL filter. */
export interface ParsedCommuteFilter {
  mode: string;
  maxMinutes: number;
}

/** Parse the existing `mode:minutes` commute URL encoding. */
export function parseCommuteFilter(value: string | null | undefined): ParsedCommuteFilter | null;
