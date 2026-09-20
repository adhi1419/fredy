/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui-19';
import {
  IconArrowRight,
  IconChevronDown,
  IconListView,
  IconMapPin,
  IconRefresh,
  IconRoute,
  IconSearch,
} from '@douyinfe/semi-icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Map as MapLibreMap, Marker as MapMarker } from 'maplibre-gl';
import maplibregl from '../../components/map/maplibre.js';
import MapCanvas from '../../components/map/Map.jsx';
import { groupListingsByPosition, getBoundsFromCoords } from '../listings/mapUtils.js';
import { useProviderCountries } from '../../hooks/useProviderCountries.js';
import { useActions, useSelector } from '../../services/state/store.js';
import { findJobsNeedingAttention } from '../../services/dashboard/attention.js';
import { xhrPost } from '../../services/xhr.js';
import { formatEuroPrice } from '../../services/price/priceService.js';
import { format as formatTime } from '../../services/time/timeService.js';
import { useLocale, useTranslation } from '../../services/i18n/i18n.jsx';
import {
  HOME_ACTIVITIES,
  HOME_SORT_OPTIONS,
  HOME_VIEWS,
  homeLifecycleState,
  homeMapListing,
  homeProviderOptions,
  homeQueryFromState,
  homeSortOption,
  normalizeProviderIds,
  readHomeViewState,
  writeHomeViewState,
  type HomeListing,
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

interface HomeJob {
  id: string;
  name?: string | null;
  enabled?: boolean;
  notificationAdapter?: readonly unknown[];
  numberOfFoundListings?: number;
}

interface HomeDashboard {
  general?: { lastRun?: number | null } | null;
}

interface HomeStoreState {
  listingsData: ListingsDataState;
  provider: readonly HomeProviderMetadata[];
  jobsData: { jobs: readonly HomeJob[] };
  dashboard: { data: HomeDashboard | null };
}

interface HomeActions {
  listingsData: { getListingsData: (query: HomeQueryPayload) => Promise<void> };
  dashboard: { getDashboard: () => Promise<void> };
}

interface AttentionJob {
  id: string;
  name: string;
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

type HomeTranslation = (key: string, values?: Record<string, string>) => string;

function formatHomeContext(lastRun: number | null | undefined, t: HomeTranslation, now = Date.now()): string {
  if (lastRun == null || lastRun === 0) return t('home.updatedNever');

  const deltaMinutes = Math.round((lastRun - now) / 60000);
  const magnitude = Math.abs(deltaMinutes);
  if (magnitude < 1) return t('home.updated', { time: t('dashboard.timeNow') });

  const unit =
    magnitude < 60
      ? { key: 'Minutes', value: magnitude }
      : magnitude < 60 * 24
        ? { key: 'Hours', value: Math.round(magnitude / 60) }
        : { key: 'Days', value: Math.round(magnitude / (60 * 24)) };
  const direction = deltaMinutes > 0 ? 'In' : 'Ago';
  const time = t(`dashboard.time${direction}${unit.key}`, { count: String(unit.value) });
  return t('home.updated', { time });
}

function activateListing(event: KeyboardEvent<HTMLElement>, onNavigate: () => void): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onNavigate();
  }
}

/**
 * The map half of Home deliberately consumes the already-filtered table result. The route-level map
 * owns its own all-listings request and controls; mounting it here would create a second fetch and a
 * second filter state for the same Home view.
 */
function HomeMap({ listings, onNavigate }: HomeMapProps) {
  const t = useTranslation();
  const locale = useLocale();
  const countries = useProviderCountries();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const markers = useMemo(() => listings.map(homeMapListing).filter((listing) => listing !== null), [listings]);

  useEffect(() => {
    if (!map) return undefined;

    const markerColor = getComputedStyle(document.body).getPropertyValue('--f-accent').trim();
    const created: Array<{ marker: MapMarker; element: HTMLElement; open: () => void }> = [];
    groupListingsByPosition(markers).forEach(({ lat, lng, listings: grouped }) => {
      const marker = new maplibregl.Marker(markerColor ? { color: markerColor } : undefined)
        .setLngLat([lng, lat])
        .addTo(map);
      const firstListing = grouped[0];
      const label =
        grouped.length > 1 ? t('home.mapMarkerMany', { count: String(grouped.length) }) : (firstListing.title ?? '');
      const element = marker.getElement();
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', label);
      element.title = label;
      const open = () => {
        if (firstListing.id) onNavigate(firstListing.id);
      };
      element.addEventListener('click', open);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      created.push({ marker, element, open });
    });

    const coordinates: Array<[number, number]> = markers.map((listing) => [listing.longitude, listing.latitude]);
    const bounds = getBoundsFromCoords(coordinates);
    const fitTimer = window.setTimeout(() => {
      map.resize();
      if (bounds) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    }, 250);

    return () => {
      window.clearTimeout(fitTimer);
      created.forEach(({ marker, element, open }) => {
        element.removeEventListener('click', open);
        marker.remove();
      });
    };
  }, [map, markers, onNavigate, t, locale]);

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
      <span className="home__map-count">{t('home.mapCount', { count: String(listings.length) })}</span>
    </section>
  );
}

/**
 * A quiet, card-light Home surface. Query state and listing lifecycle remain in the URL and the
 * existing listings Zustand slice; this view owns neither a second cache nor a second lifecycle.
 */
export default function Home({ defaultView = 'feed' }: HomeProps) {
  const t = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const actions = useActions<HomeActions>();
  const listingsData = useSelector((state: HomeStoreState) => state.listingsData);
  const providers = useSelector((state: HomeStoreState) => state.provider);
  const jobs = useSelector((state: HomeStoreState) => state.jobsData.jobs);
  const dashboard = useSelector((state: HomeStoreState) => state.dashboard.data);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const values = useMemo(() => readHomeViewState(searchParams, defaultView), [defaultView, searchParams.toString()]);
  const query = useMemo(() => homeQueryFromState(values), [values]);
  const listings = useMemo(() => asHomeListings(listingsData.result), [listingsData.result]);
  const attention = useMemo(
    () => findJobsNeedingAttention([...jobs], { lastRun: dashboard?.general?.lastRun }),
    [dashboard?.general?.lastRun, jobs],
  );
  const homeContext = useMemo(
    () => formatHomeContext(dashboard?.general?.lastRun, t),
    [dashboard?.general?.lastRun, t],
  );

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

  useEffect(() => {
    void actions.dashboard.getDashboard();
  }, [actions.dashboard]);

  const runSearches = async () => {
    try {
      await xhrPost('/api/jobs/startAll', null);
      Toast.success(t('home.searchStarted'));
    } catch {
      Toast.error(t('home.searchFailed'));
    }
  };

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
        <div className="home__heading-copy">
          <p className="home__eyebrow">{homeContext}</p>
          <h1>{t('home.heading')}</h1>
          <p className="home__description">{t('home.description')}</p>
        </div>
        <div className="home__heading-actions">
          <Button onClick={() => void runSearches()}>{t('home.runSearches')}</Button>
          <Button
            icon={<IconRefresh />}
            loading={loading}
            onClick={() => void loadData()}
            aria-label={t('home.refresh')}
          >
            {t('home.refresh')}
          </Button>
        </div>
      </header>

      {attention.length > 0 && (
        <div className="home__attention" role="status">
          <span>
            <strong>{t('home.attentionTitle')}</strong> {t('home.attentionBody', { name: attention[0].name })}
          </span>
          <Button
            theme="borderless"
            icon={<IconArrowRight />}
            onClick={() => navigate(`/jobs/edit/${attention[0].id}`)}
          >
            {t('home.attentionAction')}
          </Button>
        </div>
      )}

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
          {HOME_ACTIVITIES.map((activity) => (
            <button
              key={activity}
              type="button"
              className={values.activity === activity ? 'is-selected' : ''}
              aria-pressed={values.activity === activity}
              onClick={() => updateState({ activity, page: 1 })}
            >
              {t(ACTIVITY_LABEL_KEYS[activity as Activity])}
            </button>
          ))}
        </div>
        <div className="home__sort-provider">
          <label>
            <span>{t('home.sortLabel')}</span>
            <select value={selectedSort.key} onChange={(event) => setSort(event.target.value)}>
              {sortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
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
        </div>
      </div>

      {loading && <div className="home__state">{t('home.loading')}</div>}
      {!loading && listings.length === 0 && (
        <section className="home__empty">
          <h2>{t('home.emptyTitle')}</h2>
          <p>{t('home.emptyDescription')}</p>
          <Button theme="solid" onClick={() => navigate('/jobs/new')}>
            {t('home.createSearch')}
          </Button>
        </section>
      )}
      {!loading && listings.length > 0 && values.view === 'feed' && (
        <section className="home__feed" aria-label={t('home.feedAria')}>
          {listings.map((listing, index) => {
            const lifecycle = homeLifecycleState(listing);
            const listingId = listing.id ?? `listing-${index}`;
            const openListing = () => {
              if (listing.id) navigateToListing(listing.id);
            };
            const facts = [listing.address, listing.provider, listing.size ? `${listing.size} m²` : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <article
                key={listingId}
                className={`home__card${listing.image_url ? '' : ' home__card--no-image'}`}
                role="button"
                tabIndex={listing.id ? 0 : -1}
                aria-label={listing.title || t('listing.detail.defaultTitle')}
                onClick={openListing}
                onKeyDown={(event) => activateListing(event, openListing)}
              >
                <div className="home__card-media">
                  {listing.image_url ? (
                    <img src={listing.image_url} alt={listing.title || t('listing.detail.noImageAlt')} />
                  ) : (
                    <div className="home__card-placeholder" aria-hidden="true">
                      <IconMapPin />
                    </div>
                  )}
                </div>
                <div className="home__card-copy">
                  <span className={`home__lifecycle home__lifecycle--${lifecycle}`}>
                    {t(ACTIVITY_LABEL_KEYS[lifecycle])}
                  </span>
                  <h2>{listing.title || t('listing.detail.defaultTitle')}</h2>
                  <p>{facts || t('listing.detail.noAddress')}</p>
                </div>
                <div className="home__card-meta">
                  <strong>{listing.price ? formatEuroPrice(listing.price, locale) : t('common.na')}</strong>
                  <span>{formatTime(listing.created_at, false, locale)}</span>
                  <IconMapPin aria-hidden="true" />
                </div>
              </article>
            );
          })}
        </section>
      )}
      {!loading && listings.length > 0 && values.view === 'map' && (
        <div className="home__split">
          <section className="home__split-list" aria-label={t('home.feedAria')}>
            {listings.map((listing, index) => {
              const listingId = listing.id ?? `listing-${index}`;
              return (
                <button
                  key={listingId}
                  type="button"
                  className="home__split-row"
                  onClick={() => {
                    if (listing.id) navigateToListing(listing.id);
                  }}
                  disabled={!listing.id}
                >
                  <strong>{listing.title || t('listing.detail.defaultTitle')}</strong>
                  <span>{listing.price ? formatEuroPrice(listing.price, locale) : t('common.na')}</span>
                  <small>{listing.address || listing.provider}</small>
                </button>
              );
            })}
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
