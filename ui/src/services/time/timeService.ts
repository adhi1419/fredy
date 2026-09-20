/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export function format(ts: number | string | Date | null | undefined, showSeconds = true, locale = 'default'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    ...(showSeconds ? { second: 'numeric' } : {}),
    // Callers pass a stored timestamp (epoch millis) or a Date; the broader input union mirrors the
    // untyped call sites this replaced. Intl coerces a string via its own Date parsing, matching the
    // prior runtime, so the value is handed through unchanged rather than pre-normalised here.
  }).format(ts as number | Date | undefined);
}

/**
 * The IANA zones this browser knows, as Select options, with the stored one folded in.
 *
 * Two things this has to survive. `Intl.supportedValuesOf` is missing on older browsers, which
 * would otherwise leave the operator with an empty dropdown and no way to see or keep their
 * setting. And a value saved on the server may be a name the browser's list does not carry -
 * `US/Eastern` and the other legacy names resolve everywhere but are not listed - where a Select
 * silently renders nothing for a value that has no matching option, making a configured zone look
 * unset.
 *
 * @param current The stored zone.
 * @returns Sorted options.
 */
export function timeZoneOptions(current?: string | null): { value: string; label: string }[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const zones = new Set<string>(
    supported.length > 0 ? supported : ['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone],
  );
  if (typeof current === 'string' && current.length > 0) {
    zones.add(current);
  }
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));
}
