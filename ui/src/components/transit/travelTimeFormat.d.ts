/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/** The parsed mode and ceiling encoded by a commute URL filter. */
export interface ParsedCommuteFilter {
  mode: string;
  maxMinutes: number;
}

/** One travel mode's resolved answer for a stored entry. */
export interface ResolvedTravelMode {
  key: string;
  icon: string;
  labelKey: string;
  minutes: number;
  transfers?: number;
}

/** Parse the existing `mode:minutes` commute URL encoding. */
export function parseCommuteFilter(value: string | null | undefined): ParsedCommuteFilter | null;

/** A duration in the way people say it: minutes up to an hour, hours and minutes above. */
export function formatMinutes(minutes: number): string;

/** A road distance in the units people use, or null when the meters are not finite. */
export function formatRoadDistance(meters: number | null | undefined): string | null;

/** Whether a stored entry has an answer in any mode at all. */
export function hasAnyTime(entry: unknown): boolean;

/** The modes a stored entry actually has an answer for, in display order. */
export function availableModes(entry: unknown): ResolvedTravelMode[];

/** The one mode to show when there is only room for one, or null when the entry has no answer. */
export function primaryMode(entry: unknown): ResolvedTravelMode | null;

/** The display modes offered by Listing Detail's route picker. */
export const TRAVEL_MODES: readonly { key: string; icon: string; labelKey: string }[];
