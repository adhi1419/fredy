/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { xhrGet } from './xhr.js';
import type { TravelTimeEntry } from '../components/transit/travelTimeFormat.js';

/**
 * Client for Fredy's public transport endpoints. The backend proxies the upstream timetable API,
 * so nothing here talks to a third party directly.
 */

/** A public-transport stop near a coordinate. */
export interface NearbyStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Straight-line metres from the queried coordinate. */
  distance: number;
}

/**
 * Loads the public transport stops closest to a coordinate.
 */
export async function getNearbyStops(lat: number, lng: number, limit = 3): Promise<NearbyStop[]> {
  const query = new URLSearchParams({ lat: String(lat), lng: String(lng), limit: String(limit) });
  const response = await xhrGet(`/api/transit/stops/nearby?${query}`);
  return (response.json as { stops?: NearbyStop[] } | null)?.stops ?? [];
}

/** One scheduled departure of a stop. */
export interface Departure {
  mode: string;
  line: string;
  headsign: string;
  /** ISO timestamp of the actual departure. */
  time: string;
  scheduledTime: string;
  /** Minutes late, negative when early. */
  delay: number;
  realTime: boolean;
  color: string | null;
}

/** The resolved stop and its next departures. */
export interface DeparturesResponse {
  stop: { id: string; name: string; distance?: number };
  departures: Departure[];
}

/**
 * Loads the next departures of a stop. Either `stopId` or `lat`/`lng` must be given; passing the
 * stop `name` alongside coordinates helps the backend pick the right stop.
 */
export async function getDepartures({
  stopId,
  lat,
  lng,
  name,
  limit = 8,
}: {
  stopId?: string;
  lat?: number;
  lng?: number;
  name?: string;
  limit?: number;
}): Promise<DeparturesResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (stopId) query.set('stopId', stopId);
  if (lat != null) query.set('lat', String(lat));
  if (lng != null) query.set('lng', String(lng));
  if (name) query.set('name', name);

  const response = await xhrGet(`/api/transit/departures?${query}`);
  return response.json as DeparturesResponse;
}

/**
 * Loads how long it takes to reach a listing from each configured address.
 *
 * The backend answers from storage when it can and only routes when it has to, so this is safe to
 * call when a detail page opens. A mode missing from an entry was not routable; an empty list means
 * nothing has been computed yet, which the UI has to show as such rather than as "unreachable".
 */
export async function getTravelTimes(listingId: string): Promise<TravelTimeEntry[]> {
  const query = new URLSearchParams({ listingId: String(listingId) });
  const response = await xhrGet(`/api/transit/travel-times?${query}`);
  return (response.json as { travelTimes?: TravelTimeEntry[] } | null)?.travelTimes ?? [];
}
