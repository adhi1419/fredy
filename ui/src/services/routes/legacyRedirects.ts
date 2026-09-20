/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

/**
 * Addresses that used to be pages of their own.
 *
 * Fredy has moved things around more than once: the travel-time page was called "addresses", and
 * the standalone listings overview and its map were their own destinations before Home absorbed
 * both. Those URLs are in people's bookmarks and in the links of notification mails that have
 * already gone out, so they keep working - but they now land on canonical Home rather than on a
 * legacy list surface that still exposed Watch, a generic Status control, and Delete.
 *
 * A table rather than a wall of `<Navigate>` elements, so that "does every old address still land
 * somewhere real" is a question a test can answer.
 *
 * The listings overview, its map, and the watchlist are all Home now, so their exact entry points
 * fold into `/dashboard`. The watchlist in particular must not resolve to `/listings?watch=true`:
 * that revived the Watch concept the lifecycle rework removed. It becomes plain Home.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  // Personal settings, from before they were grouped under one heading.
  '/generalSettings': '/settings/preferences',
  '/userSettings': '/settings/preferences',
  // Was "addresses" until the page grew from a list of places into how travel time to them is
  // measured.
  '/settings/addresses': '/settings/travel-time',

  // The standalone listings overview and its map are Home now. The map entry keeps its
  // representation by asking Home for the map view; the plain list entry lands on the default feed.
  '/listings': '/dashboard',
  '/map': '/dashboard?view=map',

  // The watchlist is gone entirely, not a filter. It lands on Home with no Watch state revived.
  '/listings/watchlist': '/dashboard',
  '/watchlistManagement': '/dashboard',
};

/**
 * Query parameters that are safe to carry across a legacy redirect into Home. Everything Home reads
 * from the URL is on this list; anything else (a revived `watch` flag, arbitrary tracking params) is
 * dropped rather than forwarded, so an old deep link cannot smuggle removed state back in.
 */
const CARRIED_HOME_PARAMS: readonly string[] = Object.freeze([
  'view',
  'q',
  'freeTextFilter',
  'activity',
  'status',
  'provider',
  'providerFilter',
  'sort',
  'sortfield',
  'dir',
  'sortdir',
  'page',
]);

/**
 * Where an old address points now.
 *
 * @param pathname
 * @returns
 */
export function resolveLegacyPath(pathname: string): string | null {
  return LEGACY_REDIRECTS[pathname] ?? null;
}

/**
 * The path part of a redirect target, without its query.
 *
 * @param target
 * @returns
 */
export function targetPathname(target: string): string {
  return target.split('?')[0];
}

/**
 * Merge a legacy target's own query (e.g. `/map` forcing `view=map`) with the safe subset of an
 * incoming request's query, producing the destination a query-preserving redirect navigates to.
 *
 * The target's own params win, because they express the redirect's intent (a `/map` link is a map
 * link even if the incoming URL carried no view). Only allow-listed Home params are carried from the
 * incoming request; a `watch=true` or any unknown param is discarded. The result never carries a
 * removed concept back into Home.
 *
 * @param target The static redirect target from {@link LEGACY_REDIRECTS}.
 * @param incomingSearch The `search` string of the request being redirected (with or without `?`).
 * @returns A path (optionally with a `?query`) safe to navigate to.
 */
export function legacyRedirectTarget(target: string, incomingSearch: string | null | undefined): string {
  const path = targetPathname(target);
  const merged = new URLSearchParams();

  const incoming = new URLSearchParams(typeof incomingSearch === 'string' ? incomingSearch : '');
  for (const key of CARRIED_HOME_PARAMS) {
    const values = incoming.getAll(key);
    for (const value of values) merged.append(key, value);
  }

  // The target's own query is the redirect's intent and overrides whatever the request carried.
  const targetQuery = target.includes('?') ? target.slice(target.indexOf('?') + 1) : '';
  const targetParams = new URLSearchParams(targetQuery);
  for (const [key, value] of targetParams) {
    merged.delete(key);
    merged.append(key, value);
  }

  const serialized = merged.toString();
  return serialized ? `${path}?${serialized}` : path;
}
