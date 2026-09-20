/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui-19';
import { IconArrowRight, IconMapPin, IconRefresh } from '@douyinfe/semi-icons';
import { useNavigate, useSearchParams } from 'react-router';
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
import Headline from '../../components/headline/Headline.jsx';
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
} from '../../services/home/homeViewState.js';

import './Home.less';

const ACTIVITY_LABEL_KEYS = Object.freeze({
  new: 'home.activityNew',
  applied: 'home.activityApplied',
  viewed: 'home.activityViewed',
  archived: 'home.activityArchived',
});

/**
 * The map half of Home deliberately consumes the already-filtered table result. The route-level map
 * owns its own all-listings request and controls; mounting it here would create a second fetch and a
 * second filter state for the same Home view.
 *
 * @param {{listings: object[], onNavigate: (id: string) => void}} props
 * @returns {React.ReactElement}
 */
function HomeMap({ listings, onNavigate }) {
  const t = useTranslation();
  const locale = useLocale();
  const countries = useProviderCountries();
  const [map, setMap] = useState(null);
  const markers = useMemo(() => listings.map(homeMapListing).filter(Boolean), [listings]);

  useEffect(() => {
    if (!map) return undefined;

    const markerColor = getComputedStyle(document.body).getPropertyValue('--f-accent').trim();
    const created = [];
    groupListingsByPosition(markers).forEach(({ lat, lng, listings: grouped }) => {
      const marker = new maplibregl.Marker(markerColor ? { color: markerColor } : undefined)
        .setLngLat([lng, lat])
        .addTo(map);
      const label = grouped.length > 1 ? t('home.mapMarkerMany', { count: String(grouped.length) }) : grouped[0].title;
      const element = marker.getElement();
      element.setAttribute('role', 'button');
      element.setAttribute('tabindex', '0');
      element.setAttribute('aria-label', label);
      element.title = label;
      const open = () => onNavigate(grouped[0].id);
      element.addEventListener('click', open);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      created.push({ marker, element, open });
    });

    const coordinates = markers.map((listing) => [Number(listing.longitude), Number(listing.latitude)]);
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
        initialCenter={markers.length > 0 ? [Number(markers[0].longitude), Number(markers[0].latitude)] : undefined}
        initialZoom={markers.length > 0 ? 10 : undefined}
        controlsMode="never"
        onMapReady={setMap}
      />
      {markers.length === 0 && <p className="home__map-empty">{t('home.mapNoCoordinates')}</p>}
      <span className="home__map-count">{t('home.mapCount', { count: String(listings.length) })}</span>
    </section>
  );
}

/**
 * A quiet, card-light Home surface. Query state and listing lifecycle remain in the URL and the
 * existing listings Zustand slice; this view owns neither a second cache nor a second lifecycle.
 *
 * @param {{defaultView?: 'feed'|'map'}} props
 * @returns {React.ReactElement}
 */
export default function Home({ defaultView = 'feed' }) {
  const t = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const actions = useActions();
  const listingsData = useSelector((state) => state.listingsData);
  const providers = useSelector((state) => state.provider);
  const jobs = useSelector((state) => state.jobsData.jobs);
  const dashboard = useSelector((state) => state.dashboard.data);
  const [loading, setLoading] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const values = useMemo(() => readHomeViewState(searchParams, defaultView), [defaultView, searchParams.toString()]);
  const query = useMemo(() => homeQueryFromState(values), [values]);
  const listings = Array.isArray(listingsData?.result) ? listingsData.result : [];
  const attention = useMemo(
    () => findJobsNeedingAttention(jobs, { lastRun: dashboard?.general?.lastRun }),
    [dashboard?.general?.lastRun, jobs],
  );

  const updateState = useCallback(
    (patch) => {
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
    () => homeProviderOptions(providers, listingsData?.availableProviders ?? [], values.providerIds),
    [listingsData?.availableProviders, providers, values.providerIds],
  );

  const selectedProviders = new Set(values.providerIds);
  const selectedSort = homeSortOption(values.sort);
  const sortOptions = HOME_SORT_OPTIONS.some((option) => option.key === values.sort)
    ? HOME_SORT_OPTIONS
    : [...HOME_SORT_OPTIONS, selectedSort];
  const setSort = (value) => {
    const option = homeSortOption(value);
    updateState({ sort: option.key, dir: option.direction, page: 1 });
  };
  const navigateToListing = useCallback((id) => navigate(`/listings/listing/${id}`), [navigate]);

  return (
    <div className="home">
      <Headline
        text={t('home.title')}
        subtitle={t('home.subtitle')}
        actions={
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
        }
      />

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
        <form
          className="home__search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            updateState({ q: searchDraft.trim() || null, page: 1 });
          }}
        >
          <input
            aria-label={t('home.searchLabel')}
            value={searchDraft}
            placeholder={t('home.searchPlaceholder')}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <Button htmlType="submit">{t('home.searchAction')}</Button>
        </form>
        <div className="home__view-switch" role="group" aria-label={t('home.viewLabel')}>
          {HOME_VIEWS.map((view) => (
            <button
              key={view}
              type="button"
              className={values.view === view ? 'is-selected' : ''}
              aria-pressed={values.view === view}
              onClick={() => updateState({ view })}
            >
              {t(view === 'feed' ? 'home.feedView' : 'home.mapView')}
            </button>
          ))}
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
              {t(ACTIVITY_LABEL_KEYS[activity])}
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
            <span className="home__providers-label">{t('home.providerLabel')}</span>
            {providerOptions.length === 0 && <span className="home__provider-empty">{t('home.providersEmpty')}</span>}
            {providerOptions.map((provider) => {
              const selected = selectedProviders.has(provider.id);
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={selected ? 'is-selected' : ''}
                  aria-pressed={selected}
                  onClick={() => {
                    const next = selected
                      ? values.providerIds.filter((id) => id !== provider.id)
                      : [...values.providerIds, provider.id];
                    updateState({ providerIds: normalizeProviderIds(next), page: 1 });
                  }}
                >
                  {provider.name}
                </button>
              );
            })}
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
          {listings.map((listing) => {
            const lifecycle = homeLifecycleState(listing);
            return (
              <article
                key={listing.id}
                className={`home__row${listing.image_url ? '' : ' home__row--no-image'}`}
                role="button"
                tabIndex={0}
                onClick={() => navigateToListing(listing.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigateToListing(listing.id);
                  }
                }}
              >
                {listing.image_url && (
                  <img src={listing.image_url} alt={listing.title || t('listing.detail.noImageAlt')} />
                )}
                <div className="home__row-copy">
                  <span className={`home__lifecycle home__lifecycle--${lifecycle}`}>
                    {t(ACTIVITY_LABEL_KEYS[lifecycle] ?? 'home.activityNew')}
                  </span>
                  <h2>{listing.title || t('listing.detail.defaultTitle')}</h2>
                  <p>
                    {[listing.address, listing.provider, listing.size ? `${listing.size} m²` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="home__row-meta">
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
            {listings.map((listing) => (
              <button
                key={listing.id}
                type="button"
                className="home__split-row"
                onClick={() => navigateToListing(listing.id)}
              >
                <strong>{listing.title || t('listing.detail.defaultTitle')}</strong>
                <span>{listing.price ? formatEuroPrice(listing.price, locale) : t('common.na')}</span>
                <small>{listing.address || listing.provider}</small>
              </button>
            ))}
          </section>
          <HomeMap listings={listings} onNavigate={navigateToListing} />
        </div>
      )}

      {!loading && listings.length > 0 && (
        <div className="home__footer-state">
          {t('home.showing', { count: String(listingsData?.totalNumber ?? listings.length) })}
          {values.page > 1 && (
            <button type="button" onClick={() => updateState({ page: values.page - 1 })}>
              {t('home.previous')}
            </button>
          )}
          {values.page * query.pageSize < (listingsData?.totalNumber ?? 0) && (
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
