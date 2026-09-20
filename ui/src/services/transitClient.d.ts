/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { TravelTimeEntry } from '../components/transit/travelTimeFormat.js';

/** A public-transport stop near a coordinate. */
export interface NearbyStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Straight-line metres from the queried coordinate. */
  distance: number;
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

export function getNearbyStops(lat: number, lng: number, limit?: number): Promise<NearbyStop[]>;

export function getDepartures(params: {
  stopId?: string;
  lat?: number;
  lng?: number;
  name?: string;
  limit?: number;
}): Promise<DeparturesResponse>;

export function getTravelTimes(listingId: string): Promise<TravelTimeEntry[]>;
