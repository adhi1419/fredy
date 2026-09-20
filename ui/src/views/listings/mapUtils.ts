/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

export interface MapListing {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}

export interface MapListingGroup<T extends MapListing> {
  lat: number;
  lng: number;
  listings: T[];
}

export type MapCoordinate = readonly [number, number];
export type MapBounds = [MapCoordinate, MapCoordinate];

/**
 * Calculates the great-circle distance between two points on a sphere using the Haversine formula.
 *
 * I'm using the Haversine formula here because it accounts for the Earth's curvature.
 * By calculating the central angle (c) between two points and multiplying it by the Earth's radius (R ≈ 6371km),
 * we get a pretty accurate straight-line distance. It's basically some trigonometry involving
 * sines and cosines of the latitudes and longitudes to find the chord length (a) first.
 */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c * 10) / 10;
}

/**
 * Coordinates are compared at six decimals, about 11 cm. Two listings geocoded to the same address
 * come back with byte-identical coordinates, so this only guards against float noise - listings a
 * few metres apart stay separate pins.
 */
const POSITION_PRECISION = 6;

/**
 * Groups listings that sit on the exact same spot.
 *
 * Several flats in one building, or a whole town's worth of listings that could only be geocoded to
 * the town centre, end up as one pin with the others hidden underneath it. Grouping them lets a
 * single marker page through all of them.
 *
 * Listings without usable coordinates are dropped - they have no place on the map.
 */
export function groupListingsByPosition<T extends MapListing>(
  listings: readonly T[] | null | undefined,
): MapListingGroup<T>[] {
  const groups = new Map<string, MapListingGroup<T>>();

  for (const listing of listings ?? []) {
    const { latitude, longitude } = listing;
    if (latitude == null || longitude == null || latitude === -1 || longitude === -1) {
      continue;
    }

    const key = `${latitude.toFixed(POSITION_PRECISION)},${longitude.toFixed(POSITION_PRECISION)}`;
    const group = groups.get(key);
    if (group) {
      group.listings.push(listing);
    } else {
      groups.set(key, { lat: latitude, lng: longitude, listings: [listing] });
    }
  }

  return [...groups.values()];
}

/**
 * Generates an array of coordinates representing a circle on a map.
 *
 * To get this circle right, I'm approximating it with a polygon of 64 points.
 * Since the Earth isn't flat, I have to adjust the longitude distance based on the latitude
 * using the cosine of the latitude. The formula for the points is basically:
 * x = center_lon + radius_lon * cos(theta)
 * y = center_lat + radius_lat * sin(theta)
 * where theta ranges from 0 to 2π. This handles the slight "squishing" of distances as you move away from the equator.
 */
export function generateCircleCoords(
  center: readonly [number, number],
  radiusInKm: number,
  points = 64,
): Array<[number, number]> {
  const [longitude, latitude] = center;
  const coords: Array<[number, number]> = [];

  // 1 degree of latitude is roughly 110.574 km
  // 1 degree of longitude is roughly 111.32 km * cos(latitude)
  const distanceX = radiusInKm / (111.32 * Math.cos((latitude * Math.PI) / 180));
  const distanceY = radiusInKm / 110.574;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([longitude + x, latitude + y]);
  }
  // Close the polygon
  coords.push(coords[0]);

  return coords;
}

/**
 * Calculates the bounding box for a given center and radius.
 *
 * I'm calculating the bounds by offsetting the center coordinates by the radius.
 * Again, using the 110.574 km per degree latitude and the cosine-adjusted longitude
 * to make sure the bounds actually contain the circle, even at our latitudes.
 * I've added a bit of padding (15% by default) to make sure everything fits nicely on the screen.
 */
export function getBoundsFromCenter(
  center: readonly [number, number],
  radiusInKm: number,
  padding = 0.15,
): [[number, number], [number, number]] {
  const [lng, lat] = center;
  const kmInDegLat = 1 / 110.574;
  const kmInDegLng = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));

  const offsetLng = radiusInKm * kmInDegLng * (1 + padding);
  const offsetLat = radiusInKm * kmInDegLat * (1 + padding);

  return [
    [lng - offsetLng, lat - offsetLat],
    [lng + offsetLng, lat + offsetLat],
  ];
}

/**
 * Calculates the bounding box for a set of coordinates.
 */
export function getBoundsFromCoords(
  coords: readonly MapCoordinate[] | null | undefined,
  padding = 0.1,
): [[number, number], [number, number]] | null {
  if (!coords || coords.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  const lngDiff = maxLng - minLng;
  const latDiff = maxLat - minLat;

  return [
    [minLng - lngDiff * padding, minLat - latDiff * padding],
    [maxLng + lngDiff * padding, maxLat + latDiff * padding],
  ];
}
