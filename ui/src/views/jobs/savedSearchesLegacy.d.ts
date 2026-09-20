/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

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

declare module '*components/map/maplibre.js' {
  const maplibregl: typeof import('maplibre-gl');
  export default maplibregl;
}

declare module '*components/map/Map.jsx' {
  interface HomeMapProps {
    countries?: readonly string[];
    constrainToCountries?: boolean;
    initialCenter?: [number, number];
    initialZoom?: number;
    controlsMode?: string;
    onMapReady?: (map: import('maplibre-gl').Map) => void;
  }

  const MapCanvas: import('react').ComponentType<HomeMapProps>;
  export default MapCanvas;
}

declare module '*hooks/useProviderCountries.js' {
  export function useProviderCountries(): string[];
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

declare module '*services/price/priceService.js' {
  export function formatEuroPrice(value: number | string, locale?: string): string;
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

declare module '*services/time/timeService.js' {
  export function format(value: unknown, relative: boolean, locale: string): string;
}

declare module '*services/xhr.js' {
  interface XhrResponse {
    status: number;
    json?: unknown;
  }

  export function errorMessage(error: unknown, fallback: string): string;
  export function xhrDelete(path: string, payload: Record<string, unknown>): Promise<XhrResponse>;
  export function xhrPost(path: string, payload: unknown): Promise<XhrResponse>;
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
