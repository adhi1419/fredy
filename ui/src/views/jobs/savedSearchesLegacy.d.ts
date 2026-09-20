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

declare module '*components/ListingDeletionModal.jsx' {
  interface ListingDeletionModalProps {
    visible: boolean;
    title: string;
    showOptions: boolean;
    defaultDeleteType: string;
    message: string;
    onConfirm: (hardDelete: boolean, remember: boolean) => void | Promise<void>;
    onCancel: () => void;
  }

  const ListingDeletionModal: import('react').ComponentType<ListingDeletionModalProps>;
  export default ListingDeletionModal;
}

declare module '*components/filters/FilterButton.jsx' {
  const FilterButton: import('react').ComponentType<{
    activeCount: number;
    onClick: () => void;
  }>;
  export default FilterButton;
}

declare module '*components/filters/ActiveFilterChips.jsx' {
  const ActiveFilterChips: import('react').ComponentType<{
    chips: Array<{ key: string; label: string }>;
    onRemove: (key: string) => void;
    onClearAll: () => void;
  }>;
  export default ActiveFilterChips;
}

declare module '*components/filters/FilterDrawer.jsx' {
  const FilterDrawer: import('react').ComponentType<{
    visible: boolean;
    onClose: () => void;
    activeCount: number;
    onClearAll: () => void;
    children?: import('react').ReactNode;
  }>;

  export const FilterGroup: import('react').ComponentType<{
    title: string;
    children?: import('react').ReactNode;
  }>;

  export const FilterHelp: import('react').ComponentType<{
    children?: import('react').ReactNode;
  }>;

  export default FilterDrawer;
}

declare module '*services/jobs/jobFilters.js' {
  interface JobFilterValues {
    active: boolean | null;
  }

  interface ActiveJobFilter {
    key: string;
    label: string;
  }

  type Translator = (key: string, variables?: Record<string, string | number>) => string;

  export function clearAllFilters(): Record<string, unknown>;
  export function clearFilter(key: string): Record<string, unknown>;
  export function countActiveFilters(values: JobFilterValues): number;
  export function describeActiveFilters(values: JobFilterValues, context: { t: Translator }): ActiveJobFilter[];
}

declare module '*services/jobs/jobSummary.js' {
  export function summariseJobRefinements(
    job: import('../../services/state/jobsState').Job,
    context: {
      t: (key: string, variables?: Record<string, string | number>) => string;
      formatPrice: (value: number) => string;
    },
  ): string;
}

declare module '*services/dashboard/attention.js' {
  interface AttentionJobInput {
    id?: string;
    name?: string | null;
    notificationAdapter?: readonly unknown[];
    enabled?: boolean;
    numberOfFoundListings?: number;
  }

  interface AttentionJob {
    id: string;
    name: string;
    reason: string;
  }

  export function findJobsNeedingAttention(
    jobs: readonly AttentionJobInput[],
    options?: { lastRun?: number | null },
  ): AttentionJob[];
}

declare module '*services/state/store.js' {
  export function useSelector<State, Selected>(selector: (state: State) => Selected): Selected;
  export function useActions<Actions>(): Actions;
}

declare module '*services/sse/authenticatedEventStream.js' {
  interface AuthenticatedEvent {
    type: string;
    data?: string;
  }

  interface AuthenticatedEventStream {
    start(): void;
    close(): void;
  }

  export function createAuthenticatedEventStream(
    path: string,
    options: { onEvent: (event: AuthenticatedEvent) => void },
  ): AuthenticatedEventStream;
}

declare module '*services/xhr.js' {
  interface XhrResponse {
    status: number;
    json?: unknown;
  }

  export function errorMessage(error: unknown, fallback: string): string;
  export function xhrDelete(path: string, payload: Record<string, unknown>): Promise<XhrResponse>;
  export function xhrGet(url: string, contentType?: string, isJson?: boolean): Promise<XhrResponse>;
  export function xhrPost(path: string, payload?: unknown): Promise<XhrResponse>;
  export function xhrPut(path: string, payload: Record<string, unknown>): Promise<XhrResponse>;
}

declare module '*services/i18n/i18n.jsx' {
  export function useLocale(): string;
  export function useTranslation(): (key: string, variables?: Record<string, string | number>) => string;
}

declare module '*utils.js' {
  type Debounced<Arguments extends unknown[]> = ((...arguments_: Arguments) => void) & {
    cancel?: () => void;
  };

  export function debounce<Arguments extends unknown[]>(
    callback: (...arguments_: Arguments) => void,
    waitMilliseconds: number,
  ): Debounced<Arguments>;
}

declare module '*.png' {
  const source: string;
  export default source;
}

declare module '*utils.js' {
  export function getAddresses(settings: unknown): Array<{
    label: string;
    address: string;
    coords: { lat: number; lng: number };
  }>;
}

declare module '*components/icons/IconEuro.jsx' {
  const IconEuro: import('react').ComponentType<Record<string, unknown>>;
  export default IconEuro;
}

declare module '*ListingFinanceCard.jsx' {
  const ListingFinanceCard: import('react').ComponentType<{
    listing: { id: string; price?: number | string | null; dealType?: 'rent' | 'buy' };
  }>;
  export default ListingFinanceCard;
}

declare module '*PriceHistoryChart.jsx' {
  const PriceHistoryChart: import('react').ComponentType<{ data: readonly unknown[]; locale: string }>;
  export default PriceHistoryChart;
}

declare module '*components/connectivity/ConnectivityCard.jsx' {
  const ConnectivityCard: import('react').ComponentType<{ connectivity?: unknown }>;
  export default ConnectivityCard;
}

declare module '*AddressEditor.jsx' {
  const AddressEditor: import('react').ComponentType<{
    isManual?: boolean;
    onSave: (position: { address: string; latitude: number; longitude: number }) => Promise<void>;
    onPickOnMap: (address: string) => void;
  }>;
  export default AddressEditor;
}
