/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

declare module '@mapbox/mapbox-gl-draw' {
  import type { IControl } from 'maplibre-gl';
  import type { Feature, FeatureCollection, Geometry } from 'geojson';

  interface MapboxDrawControls {
    point?: boolean;
    line_string?: boolean;
    polygon?: boolean;
    trash?: boolean;
    combine_features?: boolean;
    uncombine_features?: boolean;
  }

  interface MapboxDrawOptions {
    displayControlsDefault?: boolean;
    controls?: MapboxDrawControls;
    styles?: ReadonlyArray<Record<string, unknown>>;
    defaultMode?: string;
  }

  class MapboxDraw implements IControl {
    constructor(options?: MapboxDrawOptions);
    onAdd(map: unknown): HTMLElement;
    onRemove(map: unknown): void;
    getAll(): FeatureCollection<Geometry>;
    set(data: FeatureCollection<Geometry>): string[];
    add(data: Feature<Geometry> | FeatureCollection<Geometry> | Geometry): string[];
    delete(ids: string | string[]): this;
    deleteAll(): this;
    static constants: {
      classes: {
        CANVAS: string;
        CONTROL_BASE: string;
        CONTROL_PREFIX: string;
        CONTROL_GROUP: string;
        ATTRIBUTION: string;
        [key: string]: string;
      };
    };
  }

  export default MapboxDraw;
}
