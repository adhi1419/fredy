/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useMemo } from 'react';

/**
 * Moves a single value between its URL string form and its in-memory value.
 *
 * `stringify` accepts `unknown` on purpose: the presets all tolerate any input at runtime, and a
 * uniform input type lets codecs of different value types share one `Schema` without variance
 * gymnastics. `parse` stays typed so a codec still documents what it produces.
 */
export interface Codec<T> {
  parse: (raw: string) => T;
  stringify: (value: unknown) => string | null;
}

// Preset codecs for the common types.
export const parseString: Codec<string | null> = {
  parse: (v) => v,
  stringify: (v) => (v == null ? null : String(v)),
};

export const parseNumber: Codec<number | null> = {
  parse: (v) => Number(v),
  stringify: (v) => (v == null ? null : String(v)),
};

export const parseBoolean: Codec<boolean> = {
  parse: (v) => v === 'true',
  stringify: (v) => (v == null ? null : String(v)),
};

// For state that is null | true | false
export const parseNullableBoolean: Codec<boolean | null> = {
  parse: (v) => (v === 'true' ? true : v === 'false' ? false : null),
  stringify: (v) => (v === null ? 'all' : String(v)),
};

/** One entry per param: its default, and how to move between string and value. */
export interface SchemaEntry {
  defaultValue: unknown;
  codec?: Codec<unknown>;
}

export type Schema = Record<string, SchemaEntry>;

/** The react-router `useSearchParams` pair, narrowed to what this hook needs. */
type SetSearchParams = (
  updater: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams),
  options?: { replace?: boolean },
) => void;
type SearchParamsPair = [URLSearchParams, SetSearchParams];

export interface UrlState {
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  setValues: (patch: Record<string, unknown>) => void;
}

/**
 * Read and write a group of URL search params as one piece of state.
 *
 * The whole group is managed together on purpose. `setSearchParams` is not a React setState: it
 * calls `navigate()`, and several calls in the same tick each read the location as it was before
 * any of them ran, so the last one wins and the others are lost. That is why filter changes used
 * to clobber each other.
 *
 * The previous fix batched individual per-key setters through a `WeakMap` keyed on the identity of
 * `setSearchParams`, flushing them in a microtask. It worked, but it rested on react-router keeping
 * that function referentially stable - an undocumented implementation detail, and the moment it
 * stopped holding the original bug would come back silently. Managing the group means one
 * `setSearchParams` call per update, so there is nothing to batch and nothing to depend on.
 *
 * @param searchParamsPair From a single `useSearchParams()` call.
 * @param schema One entry per param. Must be stable across renders (module scope or `useMemo`). A
 *   value equal to the default is dropped from the URL, so a pristine view has a clean address.
 */
export function useUrlState([searchParams, setSearchParams]: SearchParamsPair, schema: Schema): UrlState {
  // Keyed on the serialized params rather than the object: react-router hands out a new
  // URLSearchParams instance on every render, which would defeat the memo.
  const serialized = searchParams.toString();
  const values = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, { defaultValue, codec = parseString }] of Object.entries(schema)) {
      const raw = searchParams.get(key);
      out[key] = raw !== null ? codec.parse(raw) : defaultValue;
    }
    return out;
  }, [serialized, schema]);

  /**
   * Apply several params at once. One navigation, so nothing can be lost to a racing sibling.
   */
  const setValues = useCallback(
    (patch: Record<string, unknown>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            const entry = schema[key];
            if (entry == null) continue;
            const { defaultValue, codec = parseString } = entry;
            const asString = codec.stringify(value);
            // The default never appears in the URL: its absence is what the default means.
            if (value === defaultValue || asString == null) {
              next.delete(key);
            } else {
              next.set(key, asString);
            }
          }
          return next;
        },
        // Filter changes are not navigation; the back button should leave the page rather than
        // walk back through every control the user touched.
        { replace: true },
      );
    },
    [setSearchParams, schema],
  );

  const setValue = useCallback((key: string, value: unknown) => setValues({ [key]: value }), [setValues]);

  return { values, setValue, setValues };
}
