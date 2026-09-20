/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AutoComplete, Toast } from '@douyinfe/semi-ui-19';
import { IconSearch } from '@douyinfe/semi-icons';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';

import MapCanvas from '../../../../../components/map/Map.jsx';
import { debounce } from '../../../../../utils.js';
import { xhrGet } from '../../../../../services/xhr.js';
import { useTranslation } from '../../../../../services/i18n/i18n.jsx';
import { useCountriesForProviders } from '../../../../../hooks/useProviderCountries.js';
import './AreaFilter.less';

/** Close enough to see streets, far enough to still draw a neighbourhood polygon around them. */
const ADDRESS_ZOOM = 13;

/** One configured provider on the job being built: only its id matters for the map's reach. */
interface ProviderEntry {
  id?: string;
}

interface AreaFilterProps {
  /** Existing GeoJSON areas of the job. */
  spatialFilter?: FeatureCollection<Geometry> | null;
  /** Called when the drawn areas change. */
  onChange?: ((filter: FeatureCollection<Geometry>) => void) | null;
  /** The job's currently configured providers. */
  providerData?: ProviderEntry[];
}

/** A geocode lookup answers with a single point. */
interface GeocodeResult {
  lat: number;
  lng: number;
}

/**
 * The map used to draw the search areas of a job, with an address lookup above it.
 *
 * The map opens on the countries the job's providers serve, so without this the user has to pan
 * and zoom their way to the town they have in mind before they can draw anything. Searching only
 * moves the camera: it never adds an area, because where you look and what you search are
 * different decisions.
 *
 * This is the one map reading the providers ticked in the form rather than the account-wide union,
 * so its reach - and the addresses the search box will find - follow the job being built as it is
 * built.
 */
export default function AreaFilter({
  spatialFilter = null,
  onChange = null,
  providerData = [],
}: AreaFilterProps): ReactElement {
  const t = useTranslation();
  const countries = useCountriesForProviders(providerData);
  // Sent along with both lookups so the server searches the same countries the map is bounded by.
  // Empty while no provider has been added yet, which leaves the server to fall back to the union
  // across the user's other jobs.
  const providerParam = (providerData ?? [])
    .map((provider) => provider?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .join(',');
  const providerQuery = providerParam.length > 0 ? `&providers=${encodeURIComponent(providerParam)}` : '';
  const mapRef = useRef<MapLibreMap | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);

  // The suggestion endpoint talks to Nominatim, which rate-limits hard. Waiting for a pause in
  // typing keeps one lookup per address rather than one per keystroke.
  const requestSuggestions = useMemo(
    () =>
      debounce((value: string) => {
        xhrGet(`/api/user/settings/autocomplete?q=${encodeURIComponent(value)}${providerQuery}`)
          .then((response) => setSuggestions(response.status === 200 ? (response.json as string[]) : []))
          .catch(() => setSuggestions([]));
      }, 300),
    [providerQuery],
  );

  const search = (value: string) => {
    setQuery(value);
    if (!value || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    requestSuggestions(value);
  };

  const goTo = useCallback(
    async (address: string) => {
      const target = typeof address === 'string' ? address.trim() : '';
      if (target.length === 0) {
        return;
      }
      setQuery(target);
      setLocating(true);
      try {
        const response = await xhrGet(`/api/user/settings/geocode?q=${encodeURIComponent(target)}${providerQuery}`);
        const { lat, lng } = response.json as GeocodeResult;
        // The map may still be initialising on a freshly opened form; nothing to move yet.
        mapRef.current?.flyTo({ center: [lng, lat], zoom: ADDRESS_ZOOM });
      } catch {
        Toast.warning(t('jobs.mutation.areaSearchNotFound'));
      } finally {
        setLocating(false);
      }
    },
    [t, providerQuery],
  );

  return (
    <div className="areaFilter">
      <AutoComplete
        className="areaFilter__search"
        data={suggestions}
        value={query}
        onChange={(value) => search(String(value))}
        onSelect={(value) => goTo(String(value))}
        onSearch={search}
        // Enter locates whatever has been typed, so an address the suggestions never returned
        // still works.
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            goTo(query);
          }
        }}
        loading={locating}
        prefix={<IconSearch />}
        showClear
        placeholder={t('jobs.mutation.areaSearchPlaceholder')}
      />
      {/* The basemap and overlay state is left to the map: passing it here would make the controls
          it now shows read-only. Drawing a neighbourhood outline in a panel this size is fiddly,
          which is what the expand button is for. */}
      <MapCanvas
        countries={countries}
        enableDrawing={true}
        initialSpatialFilter={spatialFilter}
        onDrawingChange={onChange}
        onMapReady={(map) => {
          mapRef.current = map;
        }}
      />
    </div>
  );
}
