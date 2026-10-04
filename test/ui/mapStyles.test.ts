/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { resolveMapStyle, SATELLITE_STYLE, STANDARD_STYLE_URLS } from '../../ui/src/components/map/mapStyles.js';
import { OPENFREEMAP_GLYPHS_URL } from '../../ui/src/components/map/overlayLayers.js';

describe('resolveMapStyle', () => {
  it('follows the theme for the standard basemap', () => {
    expect(resolveMapStyle('STANDARD', 'light')).toBe(STANDARD_STYLE_URLS.light);
    expect(resolveMapStyle('STANDARD', 'dark')).toBe(STANDARD_STYLE_URLS.dark);
    expect(STANDARD_STYLE_URLS.light).not.toBe(STANDARD_STYLE_URLS.dark);
  });

  it('serves both themes from OpenFreeMap so the overlays keep their source', () => {
    for (const url of Object.values(STANDARD_STYLE_URLS)) {
      expect(url).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\//);
    }
  });

  it('keeps satellite imagery the same in both themes', () => {
    expect(resolveMapStyle('SATELLITE', 'light')).toBe(SATELLITE_STYLE);
    expect(resolveMapStyle('SATELLITE', 'dark')).toBe(SATELLITE_STYLE);
    // The transit overlay labels its stops on satellite too, so the glyphs must stay declared.
    expect(SATELLITE_STYLE.glyphs).toBe(OPENFREEMAP_GLYPHS_URL);
  });
});
