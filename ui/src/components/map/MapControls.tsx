/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Select, Switch, Typography } from '@douyinfe/semi-ui-19';
import { useTranslation } from '../../services/i18n/i18n.jsx';

const { Text } = Typography;

/** The two basemap choices the control offers. */
export type MapStyleName = 'STANDARD' | 'SATELLITE';

/** A single-action patch describing which control the user just changed. */
export interface MapControlsPatch {
  style?: MapStyleName;
  show3dBuildings?: boolean;
  showTransit?: boolean;
}

export interface MapControlsProps {
  style: MapStyleName;
  show3dBuildings: boolean;
  showTransit: boolean;
  onChange: (patch: MapControlsPatch) => void;
  /**
   * Rendered indented below the transit row while transit is on, for settings that only mean
   * something once the layer is there.
   */
  transitExtra?: import('react').ReactNode;
}

/**
 * The basemap and overlay switches every map shares.
 *
 * Presentational on purpose: it owns no state and reports changes as a patch object, so the map can
 * forward one update per user action to a parent that keeps the state somewhere else (the map
 * view's URL, for instance) without the two disagreeing in between.
 */
export default function MapControls({
  style,
  show3dBuildings,
  showTransit,
  onChange,
  transitExtra = null,
}: MapControlsProps) {
  const t = useTranslation();

  return (
    <div className="map-panel map-shell__controls">
      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterStyleLabel')}
        </Text>
        <Select
          size="small"
          value={style}
          onChange={(value) => {
            if (value === 'STANDARD' || value === 'SATELLITE') {
              onChange({ style: value });
            }
          }}
          style={{ width: 110 }}
        >
          <Select.Option value="STANDARD">{t('map.filterStyleStandard')}</Select.Option>
          <Select.Option value="SATELLITE">{t('map.filterStyleSatellite')}</Select.Option>
        </Select>
      </div>

      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filter3dBuildings')}
        </Text>
        {/* Satellite is raster imagery: there is no building geometry underneath it to extrude. */}
        <Switch
          size="small"
          checked={show3dBuildings}
          onChange={(value) => onChange({ show3dBuildings: value })}
          disabled={style === 'SATELLITE'}
        />
      </div>

      <div className="map-panel__row">
        <Text size="small" strong className="map-panel__label">
          {t('map.filterTransit')}
        </Text>
        <Switch size="small" checked={showTransit} onChange={(value) => onChange({ showTransit: value })} />
      </div>

      {showTransit && transitExtra}
    </div>
  );
}
