/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconClock,
  IconCrop,
  IconListView,
  IconMapPin,
  IconMore,
  IconPriceTag,
  IconRoute,
  IconSearch,
  IconSort,
  IconTickCircle,
  IconEyeOpened,
} from '@douyinfe/semi-icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Map as MapLibreMap, Marker as MapMarker } from 'maplibre-gl';
import maplibregl from '../../components/map/maplibre.js';
import MapCanvas from '../../components/map/Map.jsx';
import { groupListingsByPosition, getBoundsFromCoords } from '../listings/mapUtils.js';
import { useProviderCountries } from '../../hooks/useProviderCountries.js';
import { getAddresses } from '../../utils.js';
import { useActions, useSelector } from '../../services/state/store.js';
import { formatEuroPrice } from '../../services/price/priceService.js';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import {
  HOME_ACTIVITIES,
  HOME_SORT_OPTIONS,
  HOME_VIEWS,
  homeCardTravel,
  homeLifecycleState,
  homeListingNavigationId,
  homeMapListing,
  homeMapMarkerIds,
  homeMapToggleSelection,
  homeBboxFromEdges,
  homeSavedPlaceGlyph,
  HOME_PAGE_SIZE,
  type HomeBbox,
  homeProviderOptions,
  homeQueryFromState,
  homeSortOption,
  normalizeProviderIds,
  readHomeViewState,
  writeHomeViewState,
  type HomeListing,
  type HomeMapListing,
  type HomeProviderMetadata,
  type HomeQueryPayload,
  type HomeSortDirection,
  type HomeSortOption,
  type HomeView,
  type HomeViewStatePatch,
} from '../../services/home/homeViewState';
import { withReturnTo } from '../../services/routes/returnTo.js';
import { relativeListingAge } from '../../services/home/listingAge';
import type { ListingsDataState } from '../../services/state/listingsState';

import './Home.less';

const ACTIVITY_LABEL_KEYS = Object.freeze({
  new: 'home.activityNew',
  applied: 'home.activityApplied',
  viewed: 'home.activityViewed',
  archived: 'home.activityArchived',
} as const);

type Activity = keyof typeof ACTIVITY_LABEL_KEYS;

type GlyphProps = { className?: string; 'aria-hidden'?: boolean | 'true' | 'false' };

/**
 * Direction A leans on a small set of glyphs the Semi icon font does not ship in a form that reads
 * right here (a map sheet with a pin, an inbox tray for New, an archive box). They are authored as
 * inline SVG so the surface stays free of emoji and of any icon the test harness has not mocked,
 * and they inherit the current text colour through `currentColor` rather than any literal.
 */
function IconPaperMap({ className, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14M15 6v14" />
      <circle cx="15.5" cy="11" r="1.6" />
      <path d="M15.5 15c1.7-1.8 2.6-3 2.6-4.2a2.6 2.6 0 0 0-5.2 0c0 1.2.9 2.4 2.6 4.2Z" />
    </svg>
  );
}

function IconInboxTray({ className, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <path d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z" />
      <path d="M4 13h4l1.5 2.5h5L16 13h4" />
    </svg>
  );
}

function IconArchiveBox({ className, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V18a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M9.5 12h5" />
    </svg>
  );
}

type Glyph = (props: GlyphProps) => ReactElement;

/**
 * The canonical lifecycle glyphs a Direction A stay card floats over its photo. Keyed on the exact
 * same activity vocabulary as the Home activity filters ({@link HOME_ACTIVITIES}) so a card's badge
 * and the filter that surfaces it can never drift. Semi icons or inline SVG, never emoji.
 *
 * Only the two states a user reaches by acting carry a photo badge: Applied (the application
 * lifecycle is confirmed) and Viewed (a viewing happened).
 */
const LIFECYCLE_SYMBOLS: Readonly<Partial<Record<Activity, typeof IconTickCircle>>> = Object.freeze({
  applied: IconTickCircle,
  viewed: IconEyeOpened,
});

/**
 * Every activity filter pill carries its canonical glyph, so the four scope controls read as a set
 * rather than two icons and two bare words. New pairs an inbox tray, Archived an archive box, and
 * Applied/Viewed reuse the exact badge glyphs above so a pill and a card badge never diverge.
 */
const ACTIVITY_SYMBOLS: Readonly<Record<Activity, Glyph>> = Object.freeze({
  new: IconInboxTray,
  applied: IconTickCircle as unknown as Glyph,
  viewed: IconEyeOpened as unknown as Glyph,
  archived: IconArchiveBox,
});

/** The lifecycle mutations a Home card overflow menu offers, in the order Direction A lists them. */
const CARD_LIFECYCLE_ACTIONS: readonly {
  readonly activity: Activity;
  readonly action: 'applied' | 'viewing' | 'archive';
  readonly labelKey: string;
}[] = Object.freeze([
  { activity: 'applied', action: 'applied', labelKey: 'home.markApplied' },
  { activity: 'viewed', action: 'viewing', labelKey: 'home.markViewed' },
  { activity: 'archived', action: 'archive', labelKey: 'home.markArchived' },
]);

/**
 * The glyph each sort criterion wears in the icon-based sort control. Keyed on the canonical sort
 * keys ({@link HOME_SORT_OPTIONS}); an unknown future key the server may introduce falls back to a
 * neutral sort glyph so the control never renders blank. No criterion carries a visible text label -
 * the meaning is the icon plus its tooltip/aria label, so the tool row stays compact.
 */
const SORT_SYMBOLS: Readonly<Record<string, Glyph>> = Object.freeze({
  created_at: IconClock as unknown as Glyph,
  travel_time: IconRoute as unknown as Glyph,
  distance: IconMapPin as unknown as Glyph,
  price: IconPriceTag as unknown as Glyph,
  size: IconCrop as unknown as Glyph,
});

function moveMenuFocus(event: globalThis.KeyboardEvent, currentIndex: number, items: Array<HTMLButtonElement | null>) {
  let nextIndex: number | null = null;
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
  if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = items.length - 1;
  if (nextIndex == null || items.length === 0) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}

interface HomeStoreState {
  listingsData: ListingsDataState;
  provider: readonly HomeProviderMetadata[];
  userSettings?: { settings?: { home_addresses?: unknown } | null };
}

interface HomeActions {
  listingsData: {
    getListingsData: (query: HomeQueryPayload) => Promise<void>;
    appendListingsPage: (query: HomeQueryPayload) => Promise<void>;
    setListingLifecycleAction: (listingId: string, action: 'applied' | 'viewing' | 'archive') => Promise<void>;
  };
}

interface HomeProps {
  defaultView?: HomeView;
}

function asHomeListings(value: unknown): HomeListing[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is HomeListing => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
    : [];
}

interface HomeStayCardProps {
  listing: HomeListing;
  variant: 'grid' | 'split';
  /** Lit from the map: the pin under the pointer is this card's. */
  highlighted?: boolean;
  onHover?: (hovering: boolean) => void;
  onNavigate: (id: string) => void;
  onLifecycleAction: (id: string, action: 'applied' | 'viewing' | 'archive') => void | Promise<void>;
}

/**
 * One Direction A stay card, used by both Home representations. The photo-led grid and the map's
 * companion list render the same photo, lifecycle badge, facts, travel line, and navigation target,
 * so switching representation never changes the decision a card offers.
 *
 * The image and copy open Listing Detail. The overflow dots are a real, keyboard-reachable
 * lifecycle menu (Mark applied / Mark viewed / Archive) sitting outside the navigation button so the
 * card never nests one control inside another; the menu is state-aware and hides the action that
 * matches the card's current lifecycle. No Watch, Status, or Delete affordance is shown.
 */
function HomeStayCard({
  listing,
  variant,
  highlighted = false,
  onHover,
  onNavigate,
  onLifecycleAction,
}: HomeStayCardProps) {
  const t = useTranslation();
  const locale = useLocale();
  const lifecycle = homeLifecycleState(listing);
  const LifecycleSymbol = LIFECYCLE_SYMBOLS[lifecycle];
  const lifecycleLabel = t(ACTIVITY_LABEL_KEYS[lifecycle]);
  const showBadge = lifecycle === 'applied' || lifecycle === 'viewed';
  const listingId = homeListingNavigationId(listing);
  const title = listing.title || t('listing.detail.defaultTitle');
  const location = [listing.address, listing.provider].filter(Boolean).join(' · ');
  const rooms = [
    listing.rooms != null ? t('home.cardRooms', { count: String(listing.rooms) }) : null,
    listing.size ? `${listing.size} m²` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Direction A leads the meta with how long it takes to get there, not whether it is affordable:
  // the primary listing presentation carries travel duration and distance to the reference address,
  // reusing the times the row already ships. Affordability is never shown here.
  const travel = homeCardTravel(listing);

  // Every card carries how long ago the listing arrived, in coarse relative buckets ("35 mins ago",
  // "Yesterday", "Last week"). It replaces the absolute timestamp the card used to show only when it
  // had no travel line, so the freshness signal is now always present and reads the same whether or
  // not a commute is known.
  const age = relativeListingAge(listing.created_at);

  // The overflow lifecycle menu. It is a native disclosure (button + role="menu") so it stays
  // keyboard-operable and SSR-safe without a portal, and it lives outside the card's navigation
  // button so the two controls never nest. Only the actions that would change the current state are
  // offered: the action matching the card's lifecycle is hidden.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const availableActions = CARD_LIFECYCLE_ACTIONS.filter((entry) => entry.activity !== lifecycle);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) menuTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (menuOpen) menuItemRefs.current[0]?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, closeMenu]);

  const runAction = (action: 'applied' | 'viewing' | 'archive') => {
    closeMenu(true);
    if (listingId != null) void onLifecycleAction(listingId, action);
  };

  return (
    <article
      className={`home__card home__card--${variant}${highlighted ? ' home__card--highlighted' : ''}`}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onFocus={onHover ? () => onHover(true) : undefined}
      onBlur={onHover ? () => onHover(false) : undefined}
    >
      <button
        type="button"
        className="home__card-open"
        disabled={listingId == null}
        aria-label={title}
        onClick={() => {
          if (listingId != null) onNavigate(listingId);
        }}
      >
        <span className="home__card-media">
          {listing.image_url ? (
            <img src={listing.image_url} alt="" referrerPolicy="no-referrer" loading="lazy" />
          ) : (
            <span className="home__card-placeholder" aria-hidden="true">
              <IconMapPin />
            </span>
          )}
          {showBadge && (
            <span className={`home__card-badge home__card-badge--${lifecycle}`}>
              {LifecycleSymbol && <LifecycleSymbol aria-hidden="true" className="home__card-badge-symbol" />}
              {lifecycleLabel}
            </span>
          )}
        </span>
        <span className="home__card-copy">
          <span className="home__card-title-row">
            <span className="home__card-title">{title}</span>
            <strong className="home__card-price">
              {listing.price ? formatEuroPrice(listing.price, locale) : t('common.na')}
            </strong>
          </span>
          <span className="home__card-location">{location || t('listing.detail.noAddress')}</span>
          {rooms && <span className="home__card-rooms">{rooms}</span>}
          {travel ? (
            <span
              className="home__card-travel"
              title={travel.label ? t('home.travelToLabel', { label: travel.label }) : t('home.travelTo')}
            >
              <IconRoute aria-hidden="true" />
              <span className="home__card-travel-duration">{travel.duration}</span>
              {travel.distance && <span className="home__card-travel-distance">{travel.distance}</span>}
              {travel.label && (
                <span className="home__card-travel-label">{t('home.cardTo', { label: travel.label })}</span>
              )}
            </span>
          ) : null}
          {age && (
            <span className="home__card-age">
              <IconClock aria-hidden="true" />
              {age.count == null ? t(age.key) : t(age.key, { count: String(age.count) })}
            </span>
          )}
        </span>
      </button>
      {listingId != null && availableActions.length > 0 && (
        <div className="home__card-dots" ref={menuRef}>
          <button
            type="button"
            ref={menuTriggerRef}
            className="home__card-dots-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('home.cardActionsLabel')}
            title={t('home.cardActionsLabel')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <IconMore aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="home__card-menu" role="menu" aria-label={t('home.cardActionsLabel')}>
              {availableActions.map((entry, index) => (
                <button
                  key={entry.action}
                  ref={(element) => {
                    menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  role="menuitem"
                  className="home__card-menu-item"
                  onClick={() => runAction(entry.action)}
                  onKeyDown={(event) => moveMenuFocus(event.nativeEvent, index, menuItemRefs.current)}
                >
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

interface HomeMapProps {
  listings: readonly HomeListing[];
  /** The viewport the results are narrowed to; null means the map still frames the results. */
  bbox: HomeBbox | null;
  onBboxChange: (bbox: HomeBbox | null) => void;
  /** Listing IDs the user picked by activating a pin, or null when every pin counts. */
  selectedIds: readonly string[] | null;
  onSelectionChange: (ids: string[] | null) => void;
  hoveredId: string | null;
  onHoverChange: (id: string | null) => void;
}

/**
 * Glyphs for saved places, as markup because the markers are plain DOM nodes. Stroked at 1.75 so
 * they read at 14px on both basemaps; `currentColor` lets the marker's CSS colour them.
 */
const SAVED_PLACE_GLYPHS = {
  work: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18"/></svg>',
  flag: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>',
} as const;

/** How long the map may rest after a user gesture before the viewport becomes the filter. */
const BBOX_SETTLE_MS = 400;

/**
 * The map half of Home deliberately consumes the already-filtered table result. The route-level map
 * owns its own all-listings request and controls; mounting it here would create a second fetch and a
 * second filter state for the same Home view.
 *
 * Three things tie it to the list beside it:
 * - panning or zooming narrows the results to what is in view (`bbox`), after the gesture settles;
 *   programmatic camera moves (the initial fit) carry no `originalEvent` and never write it;
 * - activating a pin narrows the list to that pin's listings instead of leaving the page;
 * - the hovered card and the hovered pin highlight each other.
 */
function HomeMap({
  listings,
  bbox,
  onBboxChange,
  selectedIds,
  onSelectionChange,
  hoveredId,
  onHoverChange,
}: HomeMapProps) {
  const t = useTranslation();
  const countries = useProviderCountries();
  const userSettings = useSelector((state: HomeStoreState) => state.userSettings?.settings ?? null);
  const savedPlaces = useMemo(() => getAddresses(userSettings), [userSettings]);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const markers = useMemo(
    () => listings.map(homeMapListing).filter((listing): listing is HomeMapListing => listing !== null),
    [listings],
  );
  const markerElements = useRef(new Map<string, HTMLElement>());
  // The first fit frames the listings; after that only the user moves the camera. Kept in a ref so
  // the marker effect can re-run for new listings without re-fitting.
  const hasFittedRef = useRef(false);
  const bboxRef = useRef(bbox);
  bboxRef.current = bbox;

  // Saved places: the workplace as a briefcase, every other address as a flag. They are context, not
  // results, so they take no part in selection, hover or the viewport filter.
  useEffect(() => {
    if (!map) return undefined;
    const created = savedPlaces.map((place) => {
      const glyph = homeSavedPlaceGlyph(place.label);
      const element = document.createElement('div');
      element.className = `home__map-place home__map-place--${glyph}`;
      element.innerHTML = SAVED_PLACE_GLYPHS[glyph];
      element.setAttribute('role', 'img');
      const label = place.label || place.address;
      element.setAttribute('aria-label', label);
      element.title = label;
      // A pin points at its place, so it hangs from its tip rather than sitting on its centre.
      return new maplibregl.Marker({ element, anchor: 'bottom' })
        .setLngLat([place.coords.lng, place.coords.lat])
        .addTo(map);
    });
    return () => created.forEach((marker) => marker.remove());
  }, [map, savedPlaces]);

  // Viewport -> filter. `moveend` fires once per gesture and once per programmatic move; only the
  // gestures carry `originalEvent`, which is what keeps the initial fit from narrowing the results.
  useEffect(() => {
    if (!map) return undefined;
    let timer: number | null = null;
    const onMoveEnd = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const bounds = map.getBounds();
        onBboxChange(homeBboxFromEdges(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()));
      }, BBOX_SETTLE_MS);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      map.off('moveend', onMoveEnd);
    };
  }, [map, onBboxChange]);

  // Hover -> pin. A class toggle on the marker element, so hovering a card never rebuilds the pins.
  useEffect(() => {
    for (const [id, element] of markerElements.current) {
      element.classList.toggle('home__map-marker--hover', hoveredId != null && id.split('\u0000').includes(hoveredId));
    }
  }, [hoveredId, markers]);

  useEffect(() => {
    for (const [id, element] of markerElements.current) {
      const ids = id.split('\u0000');
      element.classList.toggle(
        'home__map-marker--selected',
        selectedIds != null && ids.some((entry) => selectedIds.includes(entry)),
      );
      element.setAttribute(
        'aria-pressed',
        selectedIds != null && ids.some((entry) => selectedIds.includes(entry)) ? 'true' : 'false',
      );
    }
  }, [selectedIds, markers]);

  useEffect(() => {
    if (!map) return undefined;

    const created: Array<{
      marker: MapMarker;
      element: HTMLElement;
      cleanup: () => void;
    }> = [];
    const elements = markerElements.current;
    elements.clear();
    const markerGroups = groupListingsByPosition(markers);
    markerGroups.forEach(({ lat, lng, listings: grouped }) => {
      const ids = homeMapMarkerIds(grouped);
      const first = grouped[0];
      const label =
        grouped.length > 1 ? t('home.mapMarkerMany', { count: String(grouped.length) }) : (first.title ?? '');
      const markerElement = document.createElement('button');
      markerElement.type = 'button';
      markerElement.className = `home__map-marker${grouped.length > 1 ? ' home__map-marker--group' : ''}`;
      markerElement.textContent = grouped.length > 1 ? String(grouped.length) : '';
      markerElement.setAttribute('aria-label', label);
      markerElement.setAttribute('aria-pressed', 'false');
      markerElement.title = label;
      const marker = new maplibregl.Marker({ element: markerElement, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      if (ids.length > 0) elements.set(ids.join('\u0000'), markerElement);

      const onClick = () => onSelectionChange(homeMapToggleSelection(selectedIds, ids));
      const onEnter = () => onHoverChange(ids[0] ?? null);
      const onLeave = () => onHoverChange(null);
      markerElement.addEventListener('click', onClick);
      markerElement.addEventListener('mouseenter', onEnter);
      markerElement.addEventListener('mouseleave', onLeave);
      markerElement.addEventListener('focus', onEnter);
      markerElement.addEventListener('blur', onLeave);
      created.push({
        marker,
        element: markerElement,
        cleanup: () => {
          markerElement.removeEventListener('click', onClick);
          markerElement.removeEventListener('mouseenter', onEnter);
          markerElement.removeEventListener('mouseleave', onLeave);
          markerElement.removeEventListener('focus', onEnter);
          markerElement.removeEventListener('blur', onLeave);
        },
      });
    });

    let fitTimer: number | null = null;
    if (!hasFittedRef.current) {
      const current = bboxRef.current;
      const coordinates: Array<[number, number]> = markers.map((listing) => [listing.longitude, listing.latitude]);
      const bounds = current
        ? ([
            [current.west, current.south],
            [current.east, current.north],
          ] as [[number, number], [number, number]])
        : getBoundsFromCoords(coordinates);
      fitTimer = window.setTimeout(() => {
        map.resize();
        if (bounds) {
          map.fitBounds(bounds, { padding: current ? 0 : 48, maxZoom: 14, duration: 0 });
          hasFittedRef.current = true;
        }
      }, 250);
    }

    return () => {
      if (fitTimer != null) window.clearTimeout(fitTimer);
      created.forEach(({ marker, cleanup }) => {
        cleanup();
        marker.remove();
      });
    };
  }, [map, markers, onHoverChange, onSelectionChange, selectedIds, t]);

  const clearSelection = () => onSelectionChange(null);
  const clearBbox = () => {
    hasFittedRef.current = false;
    onBboxChange(null);
  };

  return (
    <section className="home__map" aria-label={t('home.mapAria')}>
      <MapCanvas
        countries={countries}
        constrainToCountries={false}
        initialCenter={markers.length > 0 ? [markers[0].longitude, markers[0].latitude] : undefined}
        initialZoom={markers.length > 0 ? 10 : undefined}
        controlsMode="never"
        defaultShowTransit
        onMapReady={(readyMap) => setMap(readyMap)}
      />
      {markers.length === 0 && <p className="home__map-empty">{t('home.mapNoCoordinates')}</p>}
      <div className="home__map-count" role="status">
        <span>{bbox ? t('home.mapInView') : t('home.mapView')}</span>
        <strong>{t('home.mapCount', { count: String(markers.length) })}</strong>
        {bbox && (
          <button type="button" className="home__map-chip" onClick={clearBbox}>
            {t('home.mapClearArea')}
          </button>
        )}
        {selectedIds && (
          <button type="button" className="home__map-chip" onClick={clearSelection}>
            {t('home.mapShowAll', { count: String(selectedIds.length) })}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The Direction A "Stay cards" Home surface: an airy, photo-led marketplace grid with a rounded
 * search field, icon view controls, true pill activity filters, and compact provider/sort pills.
 * Query state and listing lifecycle remain in the URL and the existing listings Zustand slice; this
 * view owns neither a second cache nor a second lifecycle. Search health lives in the shared shell
 * header, not in a giant Home banner.
 */
export default function Home({ defaultView = 'feed' }: HomeProps) {
  const t = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const actions = useActions<HomeActions>();
  const listingsData = useSelector((state: HomeStoreState) => state.listingsData);
  const providers = useSelector((state: HomeStoreState) => state.provider);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const values = useMemo(() => readHomeViewState(searchParams, defaultView), [defaultView, searchParams.toString()]);
  const query = useMemo(() => homeQueryFromState(values), [values]);
  const allListings = useMemo(() => asHomeListings(listingsData.result), [listingsData.result]);
  // Pin selection and hover are view state, not URL state: they describe where the pointer is, and a
  // reload should start from the whole result again.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const listings = useMemo(
    () =>
      selectedIds == null
        ? allListings
        : allListings.filter((listing) => {
            const id = homeListingNavigationId(listing);
            return id != null && selectedIds.includes(id);
          }),
    [allListings, selectedIds],
  );
  const loadedCount = allListings.length;
  const totalCount = listingsData.totalNumber ?? loadedCount;
  const hasMore = loadedCount < totalCount;
  const [appending, setAppending] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const updateState = useCallback(
    (patch: HomeViewStatePatch) => {
      setSearchParams(writeHomeViewState(searchParams, patch, defaultView), { replace: true });
    },
    [defaultView, searchParams, setSearchParams],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await actions.listingsData.getListingsData(query);
    } finally {
      setLoading(false);
    }
  }, [actions, query]);

  // The endless feed: the next page is the one after the rows already held, so a partial last page
  // (a lifecycle move removed a row) still resolves to the right offset.
  const loadMore = useCallback(async () => {
    if (appending || !hasMore) return;
    setAppending(true);
    try {
      await actions.listingsData.appendListingsPage(
        homeQueryFromState(values, Math.floor(loadedCount / HOME_PAGE_SIZE) + 1),
      );
    } finally {
      setAppending(false);
    }
  }, [actions, appending, hasMore, loadedCount, values]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, values.view]);

  // A new query means a new result; whatever pin was picked belongs to the old one. The view is
  // in here too: a selection made on the map must not narrow the Quiet feed.
  useEffect(() => {
    setSelectedIds(null);
    setHoveredId(null);
  }, [query, values.view]);

  const onBboxChange = useCallback((bbox: HomeBbox | null) => updateState({ bbox }), [updateState]);
  // Once the map view has rendered, a refetch must not unmount it: a pan would otherwise tear down
  // the map it came from and fit a fresh one. Only the list dims while the box's rows load.
  const mapMountedRef = useRef(false);
  if (values.view === 'map' && !loading && allListings.length > 0) mapMountedRef.current = true;
  if (values.view !== 'map') mapMountedRef.current = false;
  const mapStays = values.view === 'map' && mapMountedRef.current;

  // A card overflow action mutates the one lifecycle through the canonical action, then reloads the
  // current query so the moved listing leaves (or joins) the active scope without a second source of
  // truth. Failures are logged; the feed simply stays as it was.
  const handleLifecycleAction = useCallback(
    async (id: string, action: 'applied' | 'viewing' | 'archive') => {
      try {
        await actions.listingsData.setListingLifecycleAction(id, action);
        await loadData();
      } catch (error) {
        console.error(`Failed to apply listing lifecycle action ${action}:`, error);
      }
    },
    [actions, loadData],
  );

  useEffect(() => {
    setSearchDraft(values.q ?? '');
  }, [values.q]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const providerOptions = useMemo(
    () => homeProviderOptions(providers, listingsData.availableProviders, values.providerIds),
    [listingsData.availableProviders, providers, values.providerIds],
  );

  const selectedProviders = new Set(values.providerIds);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement | null>(null);
  const providerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const providerOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const providerSelectedCount = values.providerIds.length;
  const providerSummary =
    providerSelectedCount === 0
      ? t('home.providerAll')
      : t('home.providerSelectedCount', { count: String(providerSelectedCount) });

  const closeProviderMenu = useCallback((restoreFocus: boolean) => {
    setProviderMenuOpen(false);
    if (restoreFocus) providerTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (providerMenuOpen) providerOptionRefs.current[0]?.focus();
  }, [providerMenuOpen]);

  useEffect(() => {
    if (!providerMenuOpen) return undefined;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (!providerMenuRef.current?.contains(event.target as Node)) closeProviderMenu(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeProviderMenu(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [providerMenuOpen, closeProviderMenu]);

  const toggleProvider = (id: string) => {
    const next = selectedProviders.has(id)
      ? values.providerIds.filter((entry) => entry !== id)
      : [...values.providerIds, id];
    updateState({ providerIds: normalizeProviderIds(next) });
  };

  const selectAllProviders = () => {
    updateState({ providerIds: [] });
  };

  const selectedSort = homeSortOption(values.sort);
  const activeDirection: HomeSortDirection = values.dir === 'asc' ? 'asc' : 'desc';
  const sortOptions = HOME_SORT_OPTIONS.some((option) => option.key === values.sort)
    ? HOME_SORT_OPTIONS
    : [...HOME_SORT_OPTIONS, selectedSort];
  // Selecting a criterion that is not active makes it active at its own default direction. Selecting
  // the one already active flips its direction, so a single control both chooses the field and lets
  // the reader reverse it without a separate direction toggle.
  const chooseSort = (option: HomeSortOption) => {
    if (option.key === values.sort) {
      updateState({ dir: activeDirection === 'asc' ? 'desc' : 'asc' });
    } else {
      updateState({ sort: option.key, dir: option.direction });
    }
  };
  const navigateToListing = useCallback(
    (id: string) => navigate(withReturnTo(`/listings/listing/${id}`, `${location.pathname}${location.search}`)),
    [location.pathname, location.search, navigate],
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateState({ q: searchDraft.trim() || null });
  };

  return (
    <div className="home">
      <header className="home__heading">
        <h1>{t('home.heading')}</h1>
        <p className="home__description">{t('home.description')}</p>
      </header>

      <div className="home__query-row">
        <form className="home__search" role="search" onSubmit={submitSearch}>
          <IconSearch aria-hidden="true" />
          <input
            aria-label={t('home.searchLabel')}
            value={searchDraft}
            placeholder={t('home.searchPlaceholder')}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
        </form>
        <div className="home__view-switch" role="group" aria-label={t('home.viewLabel')}>
          {HOME_VIEWS.map((view) => {
            const label = t(view === 'feed' ? 'home.listView' : 'home.mapView');
            return (
              <button
                key={view}
                type="button"
                className={values.view === view ? 'is-selected' : ''}
                aria-label={label}
                aria-pressed={values.view === view}
                title={label}
                onClick={() => updateState({ view })}
              >
                {view === 'feed' ? (
                  <IconListView aria-hidden="true" />
                ) : (
                  <IconPaperMap aria-hidden="true" className="home__view-icon--map" />
                )}
                <span className="home__sr-only">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="home__controls">
        <div className="home__activities" role="group" aria-label={t('home.activityLabel')}>
          {HOME_ACTIVITIES.map((activity) => {
            const ActivitySymbol = ACTIVITY_SYMBOLS[activity as Activity];
            return (
              <button
                key={activity}
                type="button"
                className={values.activity === activity ? 'is-selected' : ''}
                aria-pressed={values.activity === activity}
                onClick={() => updateState({ activity })}
              >
                {ActivitySymbol && <ActivitySymbol aria-hidden="true" className="home__activity-symbol" />}
                {t(ACTIVITY_LABEL_KEYS[activity as Activity])}
              </button>
            );
          })}
        </div>
        <div className="home__tools">
          <div className="home__providers" role="group" aria-label={t('home.providerLabel')}>
            <div className="home__provider-picker" ref={providerMenuRef}>
              <button
                type="button"
                ref={providerTriggerRef}
                className="home__provider-trigger"
                aria-haspopup="menu"
                aria-expanded={providerMenuOpen}
                onClick={() => setProviderMenuOpen((open) => !open)}
              >
                <span>{t('home.providerLabel')}</span>
                <strong>{providerSummary}</strong>
                <IconChevronDown aria-hidden="true" />
              </button>
              {providerMenuOpen && (
                <div className="home__provider-options" role="menu" aria-label={t('home.providerLabel')}>
                  <button
                    ref={(element) => {
                      providerOptionRefs.current[0] = element;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={providerSelectedCount === 0}
                    className={`home__provider-all${providerSelectedCount === 0 ? ' is-selected' : ''}`}
                    onClick={selectAllProviders}
                    onKeyDown={(event) => moveMenuFocus(event.nativeEvent, 0, providerOptionRefs.current)}
                  >
                    <span className="home__provider-check" aria-hidden="true">
                      {providerSelectedCount === 0 && <IconTickCircle />}
                    </span>
                    <span className="home__provider-name">{t('home.providerAll')}</span>
                  </button>
                  {providerOptions.length === 0 && (
                    <span className="home__provider-empty">{t('home.providersEmpty')}</span>
                  )}
                  {providerOptions.map((provider, index) => {
                    const selected = selectedProviders.has(provider.id);
                    const stale = selected && !(listingsData.availableProviders ?? []).includes(provider.id);
                    return (
                      <button
                        ref={(element) => {
                          providerOptionRefs.current[index + 1] = element;
                        }}
                        key={provider.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={selected}
                        className={selected ? 'is-selected' : ''}
                        onClick={() => toggleProvider(provider.id)}
                        onKeyDown={(event) => moveMenuFocus(event.nativeEvent, index + 1, providerOptionRefs.current)}
                      >
                        <span className="home__provider-check" aria-hidden="true">
                          {selected && <IconTickCircle />}
                        </span>
                        <span className="home__provider-name">{provider.name}</span>
                        {stale && <small>{t('home.providerUnavailable')}</small>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="home__sort" role="group" aria-label={t('home.sortLabel')}>
            {sortOptions.map((option) => {
              const SortSymbol = SORT_SYMBOLS[option.key] ?? (IconSort as unknown as Glyph);
              const isActive = option.key === values.sort;
              const criterionLabel = t(option.labelKey);
              const directionLabel = t(activeDirection === 'asc' ? 'home.sortDirectionAsc' : 'home.sortDirectionDesc');
              // The active criterion announces its direction and that tapping it flips; an inactive
              // one announces it will become the active sort. No visible text - the icon plus these
              // labels carry the meaning.
              const ariaLabel = isActive
                ? t('home.sortActiveLabel', { label: criterionLabel, direction: directionLabel })
                : t('home.sortSelectLabel', { label: criterionLabel });
              return (
                <button
                  key={option.key}
                  type="button"
                  className={isActive ? 'is-selected' : ''}
                  aria-pressed={isActive}
                  aria-label={ariaLabel}
                  title={ariaLabel}
                  onClick={() => chooseSort(option)}
                >
                  <SortSymbol aria-hidden="true" className="home__sort-symbol" />
                  {isActive &&
                    (activeDirection === 'asc' ? (
                      <IconArrowUp aria-hidden="true" className="home__sort-direction" />
                    ) : (
                      <IconArrowDown aria-hidden="true" className="home__sort-direction" />
                    ))}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading && !mapStays && <div className="home__state">{t('home.loading')}</div>}
      {!loading && listings.length === 0 && !mapStays && (
        <section className="home__empty">
          <h2>{t('home.emptyTitle')}</h2>
          <p>{t('home.emptyDescription')}</p>
        </section>
      )}
      {!loading && listings.length > 0 && values.view === 'feed' && (
        <section className="home__grid" aria-label={t('home.feedAria')}>
          {listings.map((listing, index) => (
            <HomeStayCard
              key={homeListingNavigationId(listing) ?? `listing-${index}`}
              listing={listing}
              variant="grid"
              onNavigate={navigateToListing}
              onLifecycleAction={handleLifecycleAction}
            />
          ))}
        </section>
      )}
      {(mapStays || (!loading && allListings.length > 0)) && values.view === 'map' && (
        <div className="home__split">
          <section
            className={`home__split-list${loading ? ' home__split-list--refreshing' : ''}`}
            aria-label={t('home.feedAria')}
            aria-busy={loading || undefined}
          >
            {listings.map((listing, index) => {
              const id = homeListingNavigationId(listing);
              return (
                <HomeStayCard
                  key={id ?? `listing-${index}`}
                  listing={listing}
                  variant="split"
                  highlighted={id != null && id === hoveredId}
                  onHover={(hovering) => setHoveredId(hovering ? id : null)}
                  onNavigate={navigateToListing}
                  onLifecycleAction={handleLifecycleAction}
                />
              );
            })}
            {listings.length === 0 && !loading && (
              <p className="home__state">{t(selectedIds ? 'home.mapSelectionEmpty' : 'home.mapAreaEmpty')}</p>
            )}
          </section>
          <HomeMap
            listings={allListings}
            bbox={values.bbox}
            onBboxChange={onBboxChange}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            hoveredId={hoveredId}
            onHoverChange={setHoveredId}
          />
        </div>
      )}

      {!loading && allListings.length > 0 && (
        <div className="home__footer-state">
          <span>{t('home.showingOf', { loaded: String(loadedCount), total: String(totalCount) })}</span>
          {hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={appending}>
              {appending ? t('home.loadingMore') : t('home.loadMore')}
            </button>
          )}
          <div ref={sentinelRef} className="home__sentinel" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

Home.displayName = 'Home';
