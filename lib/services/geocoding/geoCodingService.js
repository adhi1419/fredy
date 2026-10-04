/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getGeocoordinatesByAddress } from '../storage/listingsStorage.js';
import { geocode as nominatimGeocode, isPaused as isNominatimPaused } from './client/nominatimClient.js';
import { DEFAULT_COUNTRIES } from '../providers/countries.js';
import { getProviderIdsForCountries } from '../providers/providerCountries.js';
import logger from '../logger.js';

/**
 * An address with a trailing parenthesis removed, or null when there is nothing to remove.
 *
 * Kleinanzeigen writes how far a listing is from the searched point into the address, so what
 * reaches the geocoder is `40217 Unterbilk (0.6 km)`. Nominatim treats the distance as part of the
 * place name and answers "no such place", which is not an error: the listing is stored without
 * coordinates, so no area filter can judge it and no travel time is computed.
 *
 * Only the last parenthesis, only at the end, and only if something is left. Anything a portal puts
 * after the address is the portal talking about the listing rather than naming the place.
 *
 * @param {string} address
 * @returns {string|null}
 */
function withoutTrailingParenthesis(address) {
  const trimmed = address.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return trimmed.length > 0 && trimmed !== address.trim() ? trimmed : null;
}

/**
 * An address with a trailing district segment removed, or null when there is none to remove.
 *
 * ImmoScout appends its own district label after the postcode and city, as in
 * `Turmstraße 70, 10551 Berlin, Tiergarten`. The label is the portal's region name rather than the
 * place's actual Ortsteil (Turmstraße 70 is in Moabit), and Nominatim answers "no such place" for
 * the whole string while finding `Turmstraße 70, 10551 Berlin` at once.
 *
 * Only when the segment before it carries a five-digit postcode, so the dropped part is provably
 * after the postcode-and-city part of the address and never a street or house number.
 *
 * @param {string} address
 * @returns {string|null}
 */
export function withoutTrailingDistrict(address) {
  const parts = address.split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  if (!/\b\d{5}\b/.test(parts[parts.length - 2])) return null;
  const trimmed = parts
    .slice(0, -1)
    .filter((part) => part.length > 0)
    .join(', ');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Geocodes an address using Nominatim or cached results from the database.
 *
 * @param {string} address - The address to geocode.
 * @param {string[]} [countries] - ISO 3166-1 alpha-2 codes to search in. Defaults to Germany, which
 *   is what every provider that declares nothing resolves to.
 * @returns {Promise<{lat: number, lng: number}|null>} The geocoordinates or null if error. {lat: -1, lng: -1} if not found.
 */
export async function geocodeAddress(address, countries = DEFAULT_COUNTRIES) {
  if (!address) {
    return null;
  }

  try {
    // 1. Check if we already have this address geocoded in our database. Scoped to the providers
    // of the countries being asked about: the cache matches on the address text alone, so an
    // identically written street in a neighbouring country would otherwise answer for this one.
    const cachedCoordinates = await getGeocoordinatesByAddress(address, await getProviderIdsForCountries(countries));
    if (cachedCoordinates) {
      logger.debug(`Found cached geocoordinates for address: ${address}`);
      return cachedCoordinates;
    }

    // 2. If not, use Nominatim
    const coordinates = await nominatimGeocode(address, countries);

    // 3. Nothing found. Try again without whatever the portal appended in brackets, which is the
    // difference between a listing on the map and one that only shows its address.
    //
    // Only when the answer was "looked, found nothing". A null means the geocoder could not be
    // reached or is standing off after a 429, and asking again would double the requests exactly
    // when Nominatim has said to stop. Never when the first answer worked, either: `40211
    // Stadtmitte (1 km)` resolves to Düsseldorf as written and to Berlin without the distance,
    // there being a Stadtmitte in both. Since `_filterByArea` deletes listings that fall outside
    // the area, replacing a good answer with a wrong one would delete the listing rather than
    // merely misplace its pin.
    //
    // The same rule covers a trailing district label: it is dropped only after the address as
    // written found nothing.
    let result = coordinates;
    let current = address;
    for (const shorten of [withoutTrailingParenthesis, withoutTrailingDistrict]) {
      if (result == null || result.lat !== -1 || result.lng !== -1) break;
      const shorter = shorten(current);
      if (shorter == null) continue;
      logger.debug(`No coordinates for '${current}'. Trying '${shorter}'.`);
      result = await nominatimGeocode(shorter, countries);
      current = shorter;
    }

    return result;
  } catch (error) {
    logger.error('Error during geocoding:', error);
    return null;
  }
}

/**
 * Checks if we are currently in a rate limit pause.
 * @returns {boolean}
 */
export function isGeocodingPaused() {
  return isNominatimPaused();
}
