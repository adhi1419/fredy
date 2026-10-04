/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import type { StyleSpecification } from 'maplibre-gl';
import { OPENFREEMAP_GLYPHS_URL } from './overlayLayers.js';
import { currentTheme, type Theme } from '../../services/theme/theme.js';
import type { MapStyleName } from './MapControls.jsx';

/**
 * The OpenFreeMap basemap per theme. Both are served from the same tiles, glyphs and sprite as the
 * previous `bright` style, so every overlay built on the shared OpenFreeMap source keeps working;
 * only the paint differs. Positron and Dark are near-greyscale, which is what lets the ink/paper
 * palette read as one surface instead of a saturated road map pasted into it.
 */
export const STANDARD_STYLE_URLS: Record<Theme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** Esri imagery plus a boundaries-and-places label layer; the same in both themes. */
export const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // Raster tiles need no glyphs, but the transit overlay labels its stops with them - the
  // satellite imagery carries no names of its own.
  glyphs: OPENFREEMAP_GLYPHS_URL,
  sources: {
    'satellite-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    },
    'satellite-labels': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '© Esri',
    },
  },
  layers: [
    {
      id: 'satellite-tiles',
      type: 'raster',
      source: 'satellite-tiles',
      minzoom: 0,
      maxzoom: 19,
    },
    {
      id: 'satellite-labels',
      type: 'raster',
      source: 'satellite-labels',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

/**
 * Resolves a basemap choice to the style MapLibre loads.
 *
 * The standard basemap follows the interface theme; satellite imagery is the same in both. Read at
 * construction time only: `<Layout>` is keyed on the theme, so a theme switch remounts the map and
 * this runs again with the new value.
 *
 * @param {MapStyleName} name
 * @param {Theme} [theme] Defaults to the theme the document is painted in.
 * @returns {string | import('maplibre-gl').StyleSpecification}
 */
export function resolveMapStyle(name: MapStyleName, theme: Theme = currentTheme()): string | StyleSpecification {
  return name === 'SATELLITE' ? SATELLITE_STYLE : STANDARD_STYLE_URLS[theme];
}
