/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { LineString, Point } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import { describe, it, expect } from 'vitest';
import {
  applyRouteLayers,
  buildRouteData,
  removeRouteLayers,
  ROUTE_CASING_LAYER_ID,
  ROUTE_LABEL_LAYER_ID,
  ROUTE_LINE_LAYER_ID,
  ROUTE_SOURCE_ID,
  type RouteData,
  type RouteMap,
} from '../../ui/src/views/listings/detailMapLayers.js';

interface TestSource {
  type: 'geojson';
  data: RouteData;
  setData(data: RouteData): void;
}

interface TestLayer {
  id: string;
  filter?: unknown;
}

interface TestRouteMap extends RouteMap {
  layers: TestLayer[];
  sources: Record<string, TestSource>;
  getSource(id: string): TestSource | undefined;
  getLayer(id: string): TestLayer | undefined;
}

type RouteFeature = RouteData['features'][number];
type RouteLineFeature = RouteFeature & { geometry: LineString };
type RoutePointFeature = RouteFeature & { geometry: Point };

const lineFeatures = (data: RouteData): RouteLineFeature[] =>
  data.features.filter((feature): feature is RouteLineFeature => feature.geometry.type === 'LineString');

const pointFeatures = (data: RouteData): RoutePointFeature[] =>
  data.features.filter((feature): feature is RoutePointFeature => feature.geometry.type === 'Point');

/**
 * The same kind of stand-in `mapOverlayLayers.test.js` uses: only the style methods these helpers
 * touch, recording what happened so the assertions can read the resulting style. No DOM.
 */
function makeMap(): TestRouteMap {
  const sources: Record<string, TestSource> = {};
  const layers: TestLayer[] = [];

  return {
    layers,
    sources,
    getSource: (id: string) => sources[id],
    addSource: (id: string, spec: { type: 'geojson'; data: RouteData }) => {
      const source: TestSource = {
        ...spec,
        setData: (data: RouteData) => {
          source.data = data;
        },
      };
      sources[id] = source;
    },
    removeSource: (id: string) => {
      if (!(id in sources)) throw new Error(`removeSource called for missing source ${id}`);
      delete sources[id];
    },
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: (layer: LayerSpecification) => layers.push(layer),
    removeLayer: (id: string) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index === -1) throw new Error(`removeLayer called for missing layer ${id}`);
      layers.splice(index, 1);
    },
  };
}

const LISTING = { latitude: 51.2277, longitude: 6.7735 };

const HOMES = [
  { label: 'Work', coords: { lat: 51.2377, lng: 6.7735 } },
  { label: '', coords: { lat: 51.2177, lng: 6.7835 } },
];

const layerIds = (map: TestRouteMap): string[] => map.layers.map((layer) => layer.id);

describe('detailMapLayers', () => {
  describe('buildRouteData', () => {
    it('emits a line and a label per reference address', () => {
      const data = buildRouteData(LISTING, HOMES);

      expect(data.type).toBe('FeatureCollection');
      expect(data.features).toHaveLength(4);
      expect(data.features.map((feature) => feature.geometry.type)).toEqual([
        'LineString',
        'Point',
        'LineString',
        'Point',
      ]);
    });

    it('draws each line from the listing to that address', () => {
      const [line] = lineFeatures(buildRouteData(LISTING, HOMES));

      expect(line.geometry.coordinates).toEqual([
        [LISTING.longitude, LISTING.latitude],
        [HOMES[0].coords.lng, HOMES[0].coords.lat],
      ]);
    });

    it('labels the midpoint with the rounded distance, prefixed by the address label', () => {
      const [label] = pointFeatures(buildRouteData(LISTING, HOMES));

      expect(label.geometry.coordinates[0]).toBeCloseTo(6.7735, 6);
      expect(label.geometry.coordinates[1]).toBeCloseTo(51.2327, 6);
      expect(label.properties.distance).toMatch(/^Work: [\d.]+ (m|km)$/);
    });

    it('leaves out the prefix when the address has no label', () => {
      const [, label] = pointFeatures(buildRouteData(LISTING, HOMES));

      expect(label.properties.distance).toMatch(/^[\d.]+ (m|km)$/);
    });

    it('draws the road actually driven when a route has been worked out', () => {
      // Three points near the listing, encoded the way MOTIS ships geometry.
      const travelTimes = [
        {
          label: 'Work',
          car: { minutes: 14, distanceMeters: 5400, geometry: 'ygtvh^wmwt~FoFrH??wcAhnA' },
        },
      ];

      const data = buildRouteData(LISTING, HOMES, travelTimes, 'car');
      const [line] = lineFeatures(data);
      const [label] = pointFeatures(data);

      expect(line.geometry.coordinates.length).toBeGreaterThan(2);
      // Drawn from the listing outwards, like every other line this file produces.
      expect(line.geometry.coordinates[line.geometry.coordinates.length - 1][1]).toBeCloseTo(52.52, 4);
      expect(label.properties.distance).toBe('Work: 5.4 km · 14 min');
    });

    it('falls back to the straight line for an address that has no route yet', () => {
      const travelTimes = [{ label: 'Work', car: { minutes: 14, distanceMeters: 5400 } }];

      const [line] = lineFeatures(buildRouteData(LISTING, HOMES, travelTimes, 'car'));

      expect(line.geometry.coordinates).toHaveLength(2);
    });

    it('defaults to the straight line, so nothing is drawn that was never asked for', () => {
      const travelTimes = [{ label: 'Work', car: { minutes: 14, geometry: 'ygtvh^wmwt~FoFrH??wcAhnA' } }];

      expect(lineFeatures(buildRouteData(LISTING, HOMES, travelTimes))[0].geometry.coordinates).toHaveLength(2);
    });

    it('draws a transit journey as one line per leg, in the line colours', () => {
      const travelTimes = [
        {
          label: 'Work',
          transit: {
            minutes: 32,
            legs: [
              { mode: 'WALK', color: null, geometry: 'ygtvh^wmwt~FoFrH' },
              { mode: 'METRO', color: '#eb7405', geometry: 'ygtvh^wmwt~FoFrH??wcAhnA' },
            ],
          },
        },
      ];

      // One address only: the second has no travel time and would add its own straight line.
      const data = buildRouteData(LISTING, [HOMES[0]], travelTimes, 'transit');
      const features = data.features;
      const lines = lineFeatures(data);

      expect(lines).toHaveLength(2);
      // The walk keeps the default colour; the S-Bahn keeps its own.
      expect(lines[0].properties.color).toBeUndefined();
      expect(lines[1].properties.color).toBe('#eb7405');
      // Dashed for what you walk, solid for what you ride.
      expect(lines[0].properties.walking).toBe(true);
      expect(lines[1].properties.walking).toBe(false);
      expect(features.at(-1)?.properties.distance).toBe('Work: 32 min');
    });

    it('falls back to the straight line for a mode with no route stored', () => {
      const travelTimes = [{ label: 'Work', transit: { minutes: 32 } }];

      const lines = lineFeatures(buildRouteData(LISTING, HOMES, travelTimes, 'transit'));
      expect(lines[0].geometry.coordinates).toHaveLength(2);
    });

    it('produces nothing without reference addresses', () => {
      expect(buildRouteData(LISTING, []).features).toEqual([]);
      expect(buildRouteData(LISTING, undefined).features).toEqual([]);
    });
  });

  describe('applyRouteLayers', () => {
    it('adds the source and all three layers, casing first', () => {
      const map = makeMap();

      applyRouteLayers(map, buildRouteData(LISTING, HOMES));

      expect(map.getSource(ROUTE_SOURCE_ID)).toBeDefined();
      // The casing has to go down first: it is what makes a route in an operator's own colour
      // readable on top of a road of a similar colour.
      expect(layerIds(map)).toEqual([ROUTE_CASING_LAYER_ID, ROUTE_LINE_LAYER_ID, ROUTE_LABEL_LAYER_ID]);
    });

    it('splits the two layers by geometry type', () => {
      const map = makeMap();

      applyRouteLayers(map, buildRouteData(LISTING, HOMES));

      expect(map.getLayer(ROUTE_LINE_LAYER_ID)?.filter).toEqual(['==', '$type', 'LineString']);
      expect(map.getLayer(ROUTE_LABEL_LAYER_ID)?.filter).toEqual(['==', '$type', 'Point']);
    });

    // A style change drops every custom layer, so this runs again on each `styledata`.
    it('updates the existing source instead of adding the layers twice', () => {
      const map = makeMap();
      applyRouteLayers(map, buildRouteData(LISTING, HOMES));

      const nextData = buildRouteData(LISTING, [HOMES[0]]);
      applyRouteLayers(map, nextData);

      expect(layerIds(map)).toEqual([ROUTE_CASING_LAYER_ID, ROUTE_LINE_LAYER_ID, ROUTE_LABEL_LAYER_ID]);
      expect(map.getSource(ROUTE_SOURCE_ID)?.data).toBe(nextData);
    });

    it('takes the route back off when there is nothing left to draw', () => {
      const map = makeMap();
      applyRouteLayers(map, buildRouteData(LISTING, HOMES));

      applyRouteLayers(map, buildRouteData(LISTING, []));

      expect(layerIds(map)).toEqual([]);
      expect(map.getSource(ROUTE_SOURCE_ID)).toBeUndefined();
    });

    it('does nothing without a map', () => {
      expect(() => applyRouteLayers(null, buildRouteData(LISTING, HOMES))).not.toThrow();
    });
  });

  describe('removeRouteLayers', () => {
    it('is safe when nothing was ever added', () => {
      const map = makeMap();

      expect(() => removeRouteLayers(map)).not.toThrow();
      expect(layerIds(map)).toEqual([]);
    });

    // The layers reference the source, so they have to go first or MapLibre refuses.
    it('removes the layers before the source', () => {
      const map = makeMap();
      applyRouteLayers(map, buildRouteData(LISTING, HOMES));

      expect(() => removeRouteLayers(map)).not.toThrow();
      expect(map.sources).toEqual({});
    });
  });
});
