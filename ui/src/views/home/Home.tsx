/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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

/**
 * The canonical lifecycle glyphs a Direction A stay card floats over its photo. Keyed on the exact
 * same activity vocabulary as the Home activity filters ({@link HOME_ACTIVITIES}) so a card's badge
 * and the filter that surfaces it can never drift. Semi icons only, never emoji.
 *
 * Only the two states a user reaches by acting carry a symbol: Applied (the application lifecycle is
 * confirmed) and Viewed (a viewing happened). New carries no badge - a badge on every fresh card
 * would be noise. Archived is history, shown as a muted label with no glyph.
 */
const LIFECYCLE_SYMBOLS: Readonly<Partial<Record<Activity, typeof IconTickCircle>>> = Object.freeze({
  applied: IconTickCircle,
  viewed: IconEyeOpened,
});

interface HomeStoreState {
  listingsData: ListingsDataState;
  provider: readonly HomeProviderMetadata[];
}

interface HomeActions {
  listingsData: { getListingsData: (query: HomeQueryPayload) => Promise<void> };
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
}

/**
 * One Direction A stay card, used by both Home representations. The photo-led grid and the map's
 * companion list render the same photo, lifecycle badge, facts, travel line, and navigation target,
 * so switching representation never changes the decision a card offers.
 *
 * The whole card is the navigation target (image + title open Listing Detail). No Watch, Status, or
 * Delete affordance is shown; lifecycle mutations live on Listing Detail. The overflow dots are a
 * non-interactive marker in this scan surface (kept out of the tab order) so the card stays a single
 * clean click target without nesting a second control inside the button.
 */
function HomeStayCard({ listing, variant, onNavigate }: HomeStayCardProps) {
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
          <span className="home__card-dots" aria-hidden="true">
            <IconMore />
          </span>
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
                {view === 'feed' ? <IconListView aria-hidden="true" /> : <IconRoute aria-hidden="true" />}
                <span className="home__sr-only">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="home__controls">
        <div className="home__activities" role="group" aria-label={t('home.activityLabel')}>
          {HOME_ACTIVITIES.map((activity) => {
            const ActivitySymbol = LIFECYCLE_SYMBOLS[activity as Activity];
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
            <details className="home__provider-picker">
              <summary>
                <span>{t('home.providerLabel')}</span>
                <strong>{t('home.providerSelectedCount', { count: String(values.providerIds.length) })}</strong>
                <IconChevronDown aria-hidden="true" />
              </summary>
              <div className="home__provider-options">
                {providerOptions.length === 0 && (
                  <span className="home__provider-empty">{t('home.providersEmpty')}</span>
                )}
                {providerOptions.map((provider) => {
                  const selected = selectedProviders.has(provider.id);
                  const stale = selected && !(listingsData.availableProviders ?? []).includes(provider.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      aria-pressed={selected}
                      aria-label={stale ? `${provider.name}: ${t('home.providerUnavailable')}` : provider.name}
                      onClick={() => {
                        const next = selected
                          ? values.providerIds.filter((id) => id !== provider.id)
                          : [...values.providerIds, provider.id];
                        updateState({ providerIds: normalizeProviderIds(next), page: 1 });
                      }}
                    >
                      <span>{provider.name}</span>
                      {stale && <small>{t('home.providerUnavailable')}</small>}
                    </button>
                  );
                })}
              </div>
            </details>
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
