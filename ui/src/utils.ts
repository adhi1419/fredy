/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Normalize the configured distance-check addresses from user settings to an array.
 */
export interface HomeAddress {
  label: string;
  address: string;
  coords: { lat: number; lng: number };
}

export function getAddresses(settings: { home_addresses?: unknown } | null | undefined): HomeAddress[] {
  const raw = Array.isArray(settings?.home_addresses) ? (settings.home_addresses as HomeAddress[]) : [];
  return raw.filter((a) => a?.coords && a.coords.lat !== -1);
}

export interface DebouncedFunction<Args extends unknown[]> {
  (this: unknown, ...args: Args): void;
  cancel: () => void;
}

export function debounce<Args extends unknown[]>(
  fn: (this: unknown, ...args: Args) => void,
  delay: number,
): DebouncedFunction<Args> {
  let timer: ReturnType<typeof setTimeout>;

  function debounced(this: unknown, ...args: Args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  }

  debounced.cancel = () => clearTimeout(timer);

  return debounced;
}
