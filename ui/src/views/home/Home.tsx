/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import {
  IconChevronDown,
  IconListView,
  IconMapPin,
  IconMore,
  IconRoute,
  IconSearch,
  IconTickCircle,
  IconEyeOpened,
} from '@douyinfe/semi-icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Map as MapLibreMap, Marker as MapMarker } from 'maplibre-gl';
import maplibregl from '../../components/map/maplibre.js';
import MapCanvas from '../../components/map/Map.jsx';
import { groupListingsByPosition, getBoundsFromCoords } from '../listings/mapUtils.js';
import { useProviderCountries } from '../../hooks/useProviderCountries.js';
import { useActions, useSelector } from '../../services/state/store.js';
import { formatEuroPrice } from '../../services/price/priceService.js';
import { format as formatTime } from '../../services/time/timeService.js';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import {
  HOME_ACTIVITIES,
  HOME_SORT_OPTIONS,
  HOME_VIEWS,
  homeCardTravel,
  homeLifecycleState,
  homeListingNavigationId,
  homeMapListing,
  homeMapMarkerAction,
  homeMapGroupSelectionId,
  homeMapMarkerTarget,
  restoreHomeMapMarkerFocus,
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
  type HomeView,
  type HomeViewStatePatch,
} from '../../services/home/homeViewState';
import { withReturnTo } from '../../services/routes/returnTo.js';
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
}

interface HomeActions {
  listingsData: {
    getListingsData: (query: HomeQueryPayload) => Promise<void>;
    setListingLifecycleAction: (listingId: string, action: 'applied' | 'viewing' | 'archive') => Promise<void>;
  };
}

interface HomeMapProps {
  listings: readonly HomeListing[];
  onNavigate: (id: string) => void;
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
function HomeStayCard({ listing, variant, onNavigate, onLifecycleAction }: HomeStayCardProps) {
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
    <article className={`home__card home__card--${variant}`}>
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
          ) : (
            <span className="home__card-travel home__card-travel--time">
              {formatTime(listing.created_at, false, locale)}
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

/**
 * The map half of Home deliberately consumes the already-filtered table result. The route-level map
 * owns its own all-listings request and controls; mounting it here would create a second fetch and a
 * second filter state for the same Home view.
 */
function HomeMap({ listings, onNavigate }: HomeMapProps) {
  const t = useTranslation();
  const countries = useProviderCountries();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [activeGroup, setActiveGroup] = useState<readonly HomeMapListing[] | null>(null);
  const firstChooserOption = useRef<HTMLButtonElement | null>(null);
  const activeGroupTrigger = useRef<HTMLElement | null>(null);
  const markers = useMemo(
    () => listings.map(homeMapListing).filter((listing): listing is HomeMapListing => listing !== null),
    [listings],
  );
  const groupOptions =
    activeGroup
      ?.map((listing) => ({ listing, id: homeListingNavigationId(listing) }))
      .filter((entry): entry is { listing: HomeMapListing; id: string } => entry.id != null) ?? [];

  const closeGroupChooser = useCallback(() => {
    const trigger = activeGroupTrigger.current;
    activeGroupTrigger.current = null;
    setActiveGroup(null);
    restoreHomeMapMarkerFocus(trigger);
  }, []);

  const selectGroupListing = useCallback(
    (id: string) => {
      if (!activeGroup) return;
      const selectedId = homeMapGroupSelectionId(activeGroup, id);
      if (selectedId != null) {
        activeGroupTrigger.current = null;
        onNavigate(selectedId);
      }
    },
    [activeGroup, onNavigate],
  );

  useEffect(() => {
    if (activeGroup) firstChooserOption.current?.focus();
  }, [activeGroup]);

  useEffect(() => {
    setActiveGroup(null);
    activeGroupTrigger.current = null;
  }, [markers]);

  useEffect(() => {
    if (!activeGroup) return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGroupChooser();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [activeGroup, closeGroupChooser]);

  useEffect(() => {
    if (!map) return undefined;

    const markerColor = getComputedStyle(document.body).getPropertyValue('--f-accent').trim();
    const created: Array<{
      marker: MapMarker;
      element: HTMLElement;
      onClick: () => void;
      onKeyDown: (event: globalThis.KeyboardEvent) => void;
    }> = [];
    const markerGroups = groupListingsByPosition(markers);
    markerGroups.forEach(({ lat, lng, listings: grouped }) => {
      const targetId = homeMapMarkerTarget(grouped);
      const targetListing = grouped.find((listing) => homeListingNavigationId(listing) === targetId) ?? grouped[0];
      const label =
        grouped.length > 1 ? t('home.mapMarkerMany', { count: String(grouped.length) }) : (targetListing.title ?? '');
      const markerElement = grouped.length > 1 ? document.createElement('button') : undefined;
      if (markerElement) {
        markerElement.type = 'button';
        markerElement.className = 'home__map-marker home__map-marker--group';
        markerElement.textContent = String(grouped.length);
      }
      const marker = new maplibregl.Marker(
        markerElement ? { element: markerElement } : markerColor ? { color: markerColor } : undefined,
      )
        .setLngLat([lng, lat])
        .addTo(map);
      const element = marker.getElement();
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', label);
      if (grouped.length > 1) element.setAttribute('aria-haspopup', 'dialog');
      element.title = label;
      const open = (trigger: 'pointer' | 'keyboard') => {
        const action = homeMapMarkerAction(grouped, trigger);
        if (!action) return;
        if (action.kind === 'group') {
          activeGroupTrigger.current = element;
          setActiveGroup(action.listings);
        } else {
          activeGroupTrigger.current = null;
          onNavigate(action.id);
        }
      };
      const onClick = () => open('pointer');
      const onKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open('keyboard');
        }
      };
      element.addEventListener('click', onClick);
      element.addEventListener('keydown', onKeyDown);
      created.push({ marker, element, onClick, onKeyDown });
    });

    const coordinates: Array<[number, number]> = markers.map((listing) => [listing.longitude, listing.latitude]);
    const bounds = getBoundsFromCoords(coordinates);
    const fitTimer = window.setTimeout(() => {
      map.resize();
      if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }, 250);

    return () => {
      window.clearTimeout(fitTimer);
      created.forEach(({ marker, element, onClick, onKeyDown }) => {
        element.removeEventListener('click', onClick);
        element.removeEventListener('keydown', onKeyDown);
        marker.remove();
      });
    };
  }, [map, markers, onNavigate, t]);

  return (
    <section className="home__map" aria-label={t('home.mapAria')}>
      <MapCanvas
        countries={countries}
        constrainToCountries={false}
        initialCenter={markers.length > 0 ? [markers[0].longitude, markers[0].latitude] : undefined}
        initialZoom={markers.length > 0 ? 10 : undefined}
        controlsMode="never"
        onMapReady={(readyMap) => setMap(readyMap)}
      />
      {markers.length === 0 && <p className="home__map-empty">{t('home.mapNoCoordinates')}</p>}
      {activeGroup && groupOptions.length > 0 && (
        <aside
          className="home__map-chooser"
          role="dialog"
          aria-label={t('home.mapMarkerMany', { count: String(activeGroup.length) })}
        >
          <div className="home__map-chooser-heading">
            <strong>{t('home.mapMarkerMany', { count: String(activeGroup.length) })}</strong>
            <button type="button" aria-label={t('common.cancel')} onClick={closeGroupChooser}>
              ×
            </button>
          </div>
          <div className="home__map-chooser-options">
            {groupOptions.map(({ listing, id }, index) => {
              const title = listing.title || t('listing.detail.defaultTitle');
              const detail = listing.address || listing.provider || t('listing.detail.noAddress');
              return (
                <button
                  key={id}
                  ref={index === 0 ? firstChooserOption : undefined}
                  type="button"
                  onClick={() => selectGroupListing(id)}
                  aria-label={title}
                >
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </button>
              );
            })}
          </div>
        </aside>
      )}
      <div className="home__map-count">
        <span>{t('home.mapView')}</span>
        <strong>{t('home.mapCount', { count: String(markers.length) })}</strong>
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
  const listings = useMemo(() => asHomeListings(listingsData.result), [listingsData.result]);

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
    updateState({ providerIds: normalizeProviderIds(next), page: 1 });
  };

  const selectAllProviders = () => {
    updateState({ providerIds: [], page: 1 });
  };

  const selectedSort = homeSortOption(values.sort);
  const sortOptions = HOME_SORT_OPTIONS.some((option) => option.key === values.sort)
    ? HOME_SORT_OPTIONS
    : [...HOME_SORT_OPTIONS, selectedSort];
  const setSort = (value: string) => {
    const option = homeSortOption(value);
    updateState({ sort: option.key, dir: option.direction, page: 1 });
  };
  const navigateToListing = useCallback(
    (id: string) => navigate(withReturnTo(`/listings/listing/${id}`, `${location.pathname}${location.search}`)),
    [location.pathname, location.search, navigate],
  );

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateState({ q: searchDraft.trim() || null, page: 1 });
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
                {view === 'feed' ? <IconListView aria-hidden="true" /> : <IconPaperMap aria-hidden="true" />}
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
                onClick={() => updateState({ activity, page: 1 })}
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
          <label className="home__sort">
            <span className="home__sr-only">{t('home.sortLabel')}</span>
            <select value={selectedSort.key} onChange={(event) => setSort(event.target.value)}>
              {sortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {t('home.sortPrefix', { label: t(option.labelKey) })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && <div className="home__state">{t('home.loading')}</div>}
      {!loading && listings.length === 0 && (
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
      {!loading && listings.length > 0 && values.view === 'map' && (
        <div className="home__split">
          <section className="home__split-list" aria-label={t('home.feedAria')}>
            {listings.map((listing, index) => (
              <HomeStayCard
                key={homeListingNavigationId(listing) ?? `listing-${index}`}
                listing={listing}
                variant="split"
                onNavigate={navigateToListing}
                onLifecycleAction={handleLifecycleAction}
              />
            ))}
          </section>
          <HomeMap listings={listings} onNavigate={navigateToListing} />
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="home__footer-state">
          {t('home.showing', { count: String(listingsData.totalNumber ?? listings.length) })}
          {values.page > 1 && (
            <button type="button" onClick={() => updateState({ page: values.page - 1 })}>
              {t('home.previous')}
            </button>
          )}
          {values.page * query.pageSize < (listingsData.totalNumber ?? 0) && (
            <button type="button" onClick={() => updateState({ page: values.page + 1 })}>
              {t('home.next')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

Home.displayName = 'Home';
