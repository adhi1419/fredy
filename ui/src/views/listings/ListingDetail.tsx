/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { useSelector, useActions } from '../../services/state/store.js';
import type { ListingLifecycleAction } from '../../services/state/listingsState';
import {
  Typography,
  Button,
  Space,
  Image,
  Tag,
  Divider,
  Descriptions,
  Banner,
  Popconfirm,
  Spin,
  Toast,
  TextArea,
  Tooltip,
  Select,
} from '@douyinfe/semi-ui-19';
import {
  IconArrowLeft,
  IconMapPin,
  IconCart,
  IconClock,
  IconBriefcase,
  IconActivity,
  IconExternalOpen,
  IconExpand,
  IconGridView,
  IconCalendar,
  IconBolt,
  IconSend,
  IconRefresh,
  IconEdit,
  IconCopy,
  IconTickCircle,
  IconEyeOpened,
  IconArchive,
  IconUndo,
} from '@douyinfe/semi-icons';
import maplibregl from '../../components/map/maplibre.js';
import MapCanvas, { HOME_MARKER_COLOR } from '../../components/map/Map.jsx';
import { useProviderCountries } from '../../hooks/useProviderCountries.js';
import no_image from '../../assets/no_image.png';
import * as timeService from '../../services/time/timeService.js';
import { formatEuroPrice } from '../../services/price/priceService.js';
import { getBoundsFromCoords } from './mapUtils.js';
import { applyRouteLayers, buildRouteData } from './detailMapLayers.js';
import { TRAVEL_MODES, type TravelTimeEntry } from '../../components/transit/travelTimeFormat.js';
import { getAddresses } from '../../utils.js';
import { xhrPost, xhrGet, errorMessage } from '../../services/xhr.js';

import IconEuro from '../../components/icons/IconEuro.jsx';
import ListingFinanceCard from './components/ListingFinanceCard.jsx';
import PriceHistoryChart from './components/PriceHistoryChart.jsx';
import NearbyStops from '../../components/transit/NearbyStops.jsx';
import ConnectivityCard from '../../components/connectivity/ConnectivityCard.jsx';
import TravelTimes from '../../components/transit/TravelTimes.jsx';
import AddressEditor from './components/AddressEditor.jsx';
import ScrollspyTabs, { type ScrollspySection } from '../../components/scrollspy/ScrollspyTabs';
import './ListingDetail.less';
import { useTranslation, useLocale } from '../../services/i18n/i18n.jsx';
import { useFinanceProfile } from '../../hooks/useFinanceProfile.js';
import { homeCardTravel } from '../../services/home/homeViewState.js';
import { sanitizeReturnTo } from '../../services/routes/returnTo.js';
import type { Map as MapLibreMap, Marker as MapMarker } from 'maplibre-gl';
import {
  getInquirySendEligibility,
  inquiryProviderRequiresMessage,
  isInquiryProviderSupported,
} from '../../services/inquiries/profile.js';
import {
  getAppliedMessage,
  getGoogleMapsUrl,
  getListingLifecycle,
  getSafeExternalUrl,
  isListingApplied,
  LISTING_LIFECYCLE_ACTIONS,
  MOBILE_LISTING_ACTION_LABELS,
  MOBILE_LISTING_ACTION_ORDER,
} from './listingActions.js';

const { Title, Text } = Typography;
const APPLIED_TRIGGER_ID = 'listing-mobile-applied-trigger';
const LIFECYCLE_LABEL_KEYS = Object.freeze({
  new: 'home.activityNew',
  applied: 'home.activityApplied',
  viewed: 'home.activityViewed',
  archived: 'home.activityArchived',
});

type RouteMode = 'straight' | 'transit' | 'car' | 'bike' | 'walk';
type InquiryStatus = 'sending' | 'sent' | 'failed' | 'unknown' | string;

interface ListingDistance {
  label: string;
  meters: number;
}

interface PriceHistoryEntry {
  price: number;
  observed_at: number;
}

interface ListingTechnologyCoverage {
  maxDownMbit?: number | null;
  sharePercent?: number | null;
}

interface ListingMobileConnectivity {
  neutral?: Record<string, boolean | undefined>;
  operators?: Record<string, Record<string, boolean | undefined>>;
  roamingOnly?: readonly string[];
  operatorCount?: number | null;
}

interface ListingConnectivity {
  maxDownMbit?: number | null;
  sharePercent?: number | null;
  source?: string;
  technologies?: Record<string, ListingTechnologyCoverage | undefined>;
  mobile?: ListingMobileConnectivity | null;
}

interface UserSettings {
  inquiry_profile?: unknown;
  home_addresses?: readonly unknown[];
}

interface ListingRecord {
  id: string;
  title?: string | null;
  provider?: string;
  link?: string | null;
  price?: number | string | null;
  size?: number | string | null;
  rooms?: number | string | null;
  job_name?: string | null;
  created_at?: number | string | null;
  build_year?: number | string | null;
  energy_class?: string | null;
  dealType?: 'rent' | 'buy';
  lifecycle?: { state?: string } | null;
  inquiry_send_status?: InquiryStatus;
  inquiry_message?: string | null;
  image_url?: string | null;
  address?: string | null;
  address_is_manual?: number;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  distances?: readonly ListingDistance[];
  travelTimes?: readonly TravelTimeEntry[];
  connectivity?: ListingConnectivity | null;
  is_active?: number;
  description?: string | null;
}

interface ListingStoreState {
  listingsData: { currentListing: ListingRecord | null };
  userSettings: { settings: UserSettings };
  generalSettings: { settings?: { connectivityEnabled?: boolean } };
}

interface ListingActions {
  listingsData: {
    getListing: (listingId: string) => Promise<unknown>;
    setListingLifecycleAction: (listingId: string, action: ListingLifecycleAction) => Promise<void>;
    setListingNotes: (listingId: string, notes: string) => Promise<void>;
    setListingAddress: (
      listingId: string,
      position: { address: string; latitude: number; longitude: number },
    ) => Promise<void>;
    reactivateListings: (ids: readonly string[]) => Promise<void>;
  };
}

interface HomeAddress {
  label: string;
  address: string;
  coords: { lat: number; lng: number };
}

/**
 * Whether any address has a drawable route in this mode.
 *
 * Drives the note next to the picker: falling back to the straight line without saying so would
 * look like the route simply is a straight line.
 *
 * @param {Array<Object>} travelTimes
 * @param {string} mode
 * @returns {boolean}
 */
function hasRouteFor(travelTimes: readonly TravelTimeEntry[], mode: RouteMode): boolean {
  return (Array.isArray(travelTimes) ? travelTimes : []).some((entry) =>
    mode === 'transit' ? (entry.transit?.legs?.length ?? 0) > 0 : Boolean(entry[mode]?.geometry),
  );
}

export default function ListingDetail(): ReactNode {
  const t = useTranslation();
  const locale = useLocale();
  const params = useParams();
  const listingId = params.listingId ?? '';
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const navigate = useNavigate();
  const actions = useActions<ListingActions>();
  const { isComplete: buyComplete, rentComplete } = useFinanceProfile() as {
    isComplete: boolean;
    rentComplete: boolean;
  };
  const listingData = useSelector<ListingStoreState, ListingRecord | null>(
    (state) => state.listingsData.currentListing,
  );
  // Hooks and derived values still run during the initial fetch; keep their reads safe without
  // rendering a placeholder listing. The real missing-listing guard remains below the loading gate.
  const listing: ListingRecord = listingData ?? { id: listingId };
  const inquiryProviderName =
    listing?.provider === 'deutscheWohnen'
      ? 'Deutsche Wohnen'
      : listing?.provider === 'inberlinwohnen'
        ? 'HOWOGE'
        : 'ImmoScout';
  const userSettings = useSelector<ListingStoreState, UserSettings>((state) => state.userSettings.settings);
  const canApplyWithoutMessage =
    isInquiryProviderSupported(listing?.provider, listing) &&
    !inquiryProviderRequiresMessage(listing?.provider, listing);
  const connectivityEnabled = useSelector<ListingStoreState, boolean>(
    (state) => state.generalSettings.settings?.connectivityEnabled === true,
  );
  const homeAddresses = useMemo(() => getAddresses(userSettings) as HomeAddress[], [userSettings]);
  // The listing does name a provider, but the pin can be dragged anywhere the user's own searches
  // reach, so the map takes the same account-wide union the listings map does.
  const countries = useProviderCountries();
  const map = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [priceHistory, setPriceHistory] = useState<readonly PriceHistoryEntry[]>([]);
  // Set while the user is placing the listing by hand: carries the address text they typed, waiting
  // for the coordinates the map is about to give it.
  const [pinDrop, setPinDrop] = useState<{ address: string } | null>(null);
  /** Whether a manual "try again" lookup is in flight, so the button can say so. */
  const [geocodeRetrying, setGeocodeRetrying] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pinSaving, setPinSaving] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  // The travel times as the detail page loaded them, kept here because the map needs the driving
  // route that comes in the same answer. Seeded from the listing so a stored route is drawn without
  // waiting for the request that only refines it.
  const [routeTimes, setRouteTimes] = useState<readonly TravelTimeEntry[]>(listing?.travelTimes ?? []);
  // Which route the map draws. Straight line to begin with, because that is the one that needs
  // nothing fetched and so is never missing.
  const [routeMode, setRouteMode] = useState<RouteMode>('straight');

  // Draft inquiry message state
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftCopied, setDraftCopied] = useState(false);
  const [inquirySending, setInquirySending] = useState(false);
  const inquirySendInFlightRef = useRef(false);
  const [appliedPopoverOpen, setAppliedPopoverOpen] = useState(false);
  const appliedCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const notesSectionRef = useRef<HTMLDivElement | null>(null);
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);

  const getCurrentInquirySendEligibility = () =>
    getInquirySendEligibility({
      providerId: listing.provider,
      listing,
      profile: userSettings?.inquiry_profile,
      message: draftMessage,
      status: listing.inquiry_send_status,
    });

  const closeAppliedPopover = () => {
    setAppliedPopoverOpen(false);
    requestAnimationFrame(() => document.getElementById(APPLIED_TRIGGER_ID)?.focus());
  };

  useEffect(() => {
    if (!appliedPopoverOpen) return undefined;
    appliedCloseButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAppliedPopover();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [appliedPopoverOpen]);

  useEffect(() => {
    setRouteTimes(listing?.travelTimes ?? []);
  }, [listing?.id, listing?.travelTimes]);

  useEffect(() => {
    document.querySelector('.app__content')?.scrollTo({ top: 0 });
  }, [listingId]);

  useEffect(() => {
    async function fetchListing() {
      try {
        setLoading(true);
        await actions.listingsData.getListing(listingId);
      } catch (e) {
        console.error('Failed to load listing details:', e);
        Toast.error(t('listing.detail.toastLoadError'));
        navigate(returnTo ?? '/listings');
      } finally {
        setLoading(false);
      }
    }
    fetchListing();
  }, [listingId]);

  useEffect(() => {
    setNotesDraft(listing?.notes ?? '');
  }, [listing?.id, listing?.notes]);

  // Show the eagerly-generated draft (produced at scrape time and stored on the
  // listing) as soon as the page loads, so the user sees and can copy it without
  // spending a fresh Gemini call. The Generate button then acts as a regenerate.
  // Keyed on listing id only: a manual regenerate replaces draftMessage in place
  // and must not be clobbered when the listing object is re-read for other reasons.
  useEffect(() => {
    setDraftMessage(listing?.inquiry_message ?? null);
    setDraftError(null);
    setDraftCopied(false);
  }, [listing?.id]);

  // Fetched separately from the listing rather than joined onto it: most views never draw the
  // chart, and a series has no size bound, so it must not ride along on every listing read.
  useEffect(() => {
    let cancelled = false;
    async function fetchPriceHistory() {
      try {
        // xhrGet resolves { status, json }, not the payload itself.
        const { json } = await xhrGet(`/api/listings/${listingId}/priceHistory`);
        if (!cancelled) setPriceHistory(Array.isArray(json) ? (json as readonly PriceHistoryEntry[]) : []);
      } catch {
        // A missing history is not an error worth interrupting the page for - the chart simply
        // does not render.
        if (!cancelled) setPriceHistory([]);
      }
    }
    fetchPriceHistory();
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const listingCoords = useMemo(
    () =>
      typeof listing.latitude === 'number' &&
      typeof listing.longitude === 'number' &&
      listing.latitude !== -1 &&
      listing.longitude !== -1
        ? ([listing.longitude, listing.latitude] as [number, number])
        : undefined,
    [listing.latitude, listing.longitude],
  );
  const hasGeo = listingCoords != null;

  /**
   * Two very different reasons a listing has no position, which used to share one sentence.
   *
   * NULL means nobody has managed to look it up yet: the lookup at scrape time is best effort, and a
   * timeout or a rate limit leaves it empty until the next sweep. That is temporary and worth
   * retrying, and telling somebody their listing "has no valid geocoordinates" while its address sits
   * on the same screen reads as a claim about the listing rather than about Fredy (issue #418).
   *
   * -1 is the geocoder's "looked, found nothing". That one really is about the address, it will not
   * fix itself, and the way out is the pin drop rather than another lookup.
   */
  const geoUnresolved = !hasGeo && listing?.latitude === -1;

  // Where the map opens. Without coordinates - the case pin dropping exists for - the user's own
  // reference address is the best guess at the right part of the country; failing that, the map's
  // own default view of Germany.
  const mapCenter =
    listingCoords ??
    (homeAddresses.length > 0
      ? ([homeAddresses[0].coords.lng, homeAddresses[0].coords.lat] as [number, number])
      : undefined);

  // Escape steps out of pin dropping first; the map keeps its own Escape for collapsing, which the
  // next press then reaches.
  useEffect(() => {
    if (!pinDrop) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPinDrop(null);
      setPickedCoords(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pinDrop]);

  const handleMapReady = useCallback((mapInstance: MapLibreMap) => {
    map.current = mapInstance;
    setMapReady(true);
  }, []);

  // Everything drawn on top of the shared map: the listing, the reference addresses and the lines
  // between them. The map itself is no longer created or destroyed here, so this only ever adds and
  // removes its own markers.
  useEffect(() => {
    if (!mapReady || !map.current || listingCoords == null) return undefined;

    const mapInstance = map.current;
    const markers: MapMarker[] = [];

    markers.push(
      new maplibregl.Marker({ color: '#3FB1CE' })
        .setLngLat(listingCoords)
        .setPopup(
          new maplibregl.Popup({ offset: 25 }).setHTML(
            `<h4>${t('listing.detail.mapPopupListingLocation')}</h4><p>${listing.address}</p>`,
          ),
        )
        .addTo(mapInstance),
    );

    homeAddresses.forEach((home: HomeAddress) => {
      markers.push(
        new maplibregl.Marker({ color: HOME_MARKER_COLOR })
          .setLngLat([home.coords.lng, home.coords.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              `<h4>${home.label || t('listing.detail.mapPopupHomeAddress')}</h4><p>${home.address}</p>`,
            ),
          )
          .addTo(mapInstance),
      );
    });

    if (homeAddresses.length > 0) {
      const bounds = getBoundsFromCoords([
        listingCoords,
        ...homeAddresses.map((home): [number, number] => [home.coords.lng, home.coords.lat]),
      ]);
      if (bounds != null) mapInstance.fitBounds(bounds, { padding: 50, maxZoom: 15 });
    } else {
      // The map is built once and kept, so moving to another listing has to move the camera - the
      // constructor's center belongs to whichever listing was open first.
      mapInstance.jumpTo({ center: listingCoords, zoom: 14 });
    }

    // `styledata` rather than a one-shot `load`: switching the basemap drops every custom source
    // and layer, and the route has to come back with the new style. `applyRouteLayers` is
    // idempotent for exactly that reason.
    const drawRoute = () =>
      applyRouteLayers(
        mapInstance,
        buildRouteData(
          { ...listing, latitude: listingCoords[1], longitude: listingCoords[0] },
          homeAddresses,
          routeTimes,
          routeMode,
        ),
      );
    if (mapInstance.isStyleLoaded()) drawRoute();
    mapInstance.on('styledata', drawRoute);

    return () => {
      markers.forEach((marker) => marker.remove());
      mapInstance.off('styledata', drawRoute);
    };
  }, [mapReady, listing, listingCoords, homeAddresses, routeTimes, routeMode, t]);

  const handleReactivate = async () => {
    try {
      await actions.listingsData.reactivateListings([listing.id]);
      await actions.listingsData.getListing(listingId);
      Toast.success(t('listings.toastReactivated'));
    } catch (e) {
      console.error('Failed to reactivate listing:', e);
      Toast.error(t('listings.toastReactivateError'));
    }
  };

  const handleDraftMessage = async () => {
    if (!listing) return;
    setDraftLoading(true);
    setDraftError(null);
    setDraftMessage(null);
    setDraftCopied(false);
    try {
      const response = await xhrPost(`/api/listings/${listing.id}/draft-message`, {});
      const payload = response.json as { message?: string };
      setDraftMessage(payload.message ?? null);
    } catch (e) {
      if ((e as { status?: number })?.status === 404) {
        setDraftError(t('listing.detail.draftMessage.notEnabled'));
      } else {
        setDraftError(t('listing.detail.draftMessage.error'));
      }
    } finally {
      setDraftLoading(false);
    }
  };

  const handleCopyDraft = async () => {
    try {
      if (draftMessage == null) return;
      await navigator.clipboard.writeText(draftMessage);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 2000);
    } catch {
      Toast.error(t('listing.detail.draftMessage.error'));
    }
  };

  const handleSendInquiry = async () => {
    const eligibility = getCurrentInquirySendEligibility();
    if (!eligibility.canSend || inquirySendInFlightRef.current) return;
    inquirySendInFlightRef.current = true;
    setInquirySending(true);
    try {
      await xhrPost(`/api/listings/${listing.id}/send-inquiry`, { message: draftMessage ?? '' });
      await actions.listingsData.getListing(listingId);
      Toast.success(t('listing.detail.inquirySend.success'));
    } catch (error) {
      await actions.listingsData.getListing(listingId);
      Toast.error(errorMessage(error, t('listing.detail.inquirySend.error')));
    } finally {
      inquirySendInFlightRef.current = false;
      setInquirySending(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!listing) return;
    setNotesSaving(true);
    try {
      await actions.listingsData.setListingNotes(listing.id, notesDraft);
      await actions.listingsData.getListing(listingId);
      Toast.success(t('listing.detail.toastNotesSaved'));
    } catch (e) {
      console.error('Failed to save notes:', e);
      Toast.error(t('listing.detail.toastNotesError'));
    } finally {
      setNotesSaving(false);
    }
  };

  const handleLifecycleAction = async (action: ListingLifecycleAction, successKey: string) => {
    try {
      await actions.listingsData.setListingLifecycleAction(listing.id, action);
      await actions.listingsData.getListing(listingId);
      Toast.success(t(successKey));
    } catch (error) {
      console.error(`Failed to apply listing lifecycle action ${action}:`, error);
      Toast.error(errorMessage(error, t('listing.detail.mobile.lifecycleError')));
    }
  };

  const focusNotes = () => {
    notesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => notesInputRef.current?.focus?.());
  };

  const handleMobileApply = () => {
    if (isListingApplied(listing)) {
      if (appliedPopoverOpen) closeAppliedPopover();
      else setAppliedPopoverOpen(true);
      return;
    }
    const eligibility = getCurrentInquirySendEligibility();
    if (!eligibility.providerSupported || !eligibility.statusAllowsSend) return;
    if (!eligibility.profileReady) {
      navigate('/settings/inquiry-profile');
      return;
    }
    if (!eligibility.messageReady) void handleDraftMessage();
  };

  const handleManualApply = () =>
    handleLifecycleAction(LISTING_LIFECYCLE_ACTIONS.appliedSelf, 'listing.detail.mobile.appliedToast');
  const handleViewing = () =>
    handleLifecycleAction(LISTING_LIFECYCLE_ACTIONS.viewing, 'listing.detail.mobile.viewingToast');
  const handleArchive = () =>
    handleLifecycleAction(LISTING_LIFECYCLE_ACTIONS.archive, 'listing.detail.mobile.archiveToast');
  // Un-archive is the reverse of Archive. The backend `/status` route accepts `restore` and maps it
  // back to the `new` state, so no separate endpoint is needed - the action map deliberately does
  // not name it, so it is passed as the literal the route expects.
  const handleUnarchive = () => handleLifecycleAction('restore', 'listing.detail.mobile.unarchiveToast');

  /**
   * Store an address the user picked, then re-read the listing so map, distances and the nearby
   * stops all move to the new position.
   *
   * @param {{address: string, latitude: number, longitude: number}} position
   */
  const saveAddress = async (position: { address: string; latitude: number; longitude: number }) => {
    try {
      await actions.listingsData.setListingAddress(listingId, position);
      await actions.listingsData.getListing(listingId);
      Toast.success(t('listing.detail.toastAddressSaved'));
    } catch (error) {
      Toast.error(errorMessage(error, t('listing.detail.toastAddressError')));
      throw error;
    }
  };

  /**
   * Ask for this listing's coordinates again.
   *
   * The lookup at scrape time is best effort, so a timeout or a rate limit leaves a listing with an
   * address on screen and nothing on the map. Until this button, the only remedy was the six-hourly
   * sweep, or the trick of opening Settings and pressing Save (issue #418).
   *
   * Each answer gets its own message, because they ask for different things: wait, fix the address,
   * or nothing at all.
   */
  const retryGeocoding = async () => {
    setGeocodeRetrying(true);
    try {
      const response = await xhrPost(`/api/listings/${listingId}/geocode`, {});
      const status = (response.json as { status?: string } | undefined)?.status;
      if (status === 'found') {
        await actions.listingsData.getListing(listingId);
        Toast.success(t('listing.detail.toastGeoFound'));
      } else if (status === 'unavailable') {
        Toast.warning(t('listing.detail.toastGeoUnavailable'));
      } else {
        Toast.warning(t('listing.detail.toastGeoNotFound'));
      }
    } catch (error) {
      Toast.error(errorMessage(error, t('listing.detail.toastGeoError')));
    } finally {
      setGeocodeRetrying(false);
    }
  };

  /**
   * Hand over from "no such address" to putting the listing on the map by hand. The map is expanded
   * for it: picking a building out of a 400px panel is not a fair ask.
   *
   * @param {string} address - What the user typed, kept as the address text.
   */
  const startPinDrop = (address: string) => {
    setPinDrop({ address });
    setPickedCoords(null);
    setMapExpanded(true);
  };

  const cancelPinDrop = () => {
    setPinDrop(null);
    setPickedCoords(null);
  };

  const savePinnedAddress = async () => {
    if (!pinDrop || !pickedCoords) return;
    setPinSaving(true);
    try {
      await saveAddress({ address: pinDrop.address, latitude: pickedCoords.lat, longitude: pickedCoords.lng });
      cancelPinDrop();
      setMapExpanded(false);
    } catch {
      // saveAddress already told the user; staying in pin mode lets them try again.
    } finally {
      setPinSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!listingData) return null;

  const lifecycle = getListingLifecycle(listing);
  const listingApplied = lifecycle === 'applied' || isListingApplied(listing);
  const listingViewed = lifecycle === 'viewed';
  const listingArchived = lifecycle === 'archived';
  const lifecycleLabel = t(LIFECYCLE_LABEL_KEYS[lifecycle]);
  // The lifecycle badge pairs an icon with its label so state is never colour-only. Computed here
  // rather than inline so the badge JSX stays compact next to its label.
  const lifecycleIcon: ReactNode =
    lifecycle === 'applied' ? (
      <IconTickCircle aria-hidden="true" />
    ) : lifecycle === 'viewed' ? (
      <IconEyeOpened aria-hidden="true" />
    ) : lifecycle === 'archived' ? (
      <IconArchive aria-hidden="true" />
    ) : null;
  const primaryTravel = homeCardTravel({ travelTimes: listing.travelTimes });
  const appliedMessage = getAppliedMessage(listing);
  const googleMapsUrl = getGoogleMapsUrl(listing);
  const providerListingUrl = getSafeExternalUrl(listing.link);
  const inquiryEligibility = getCurrentInquirySendEligibility();
  const applyNeedsConfirmation = inquiryEligibility.canSend;

  const data: Array<{ key: string; value: ReactNode; Icon: ReactNode; helpText: string }> = [
    {
      key: t('listing.detail.fieldPrice'),
      value: listing.price ? (
        <span className="listing-detail__price">{formatEuroPrice(listing.price, locale)}</span>
      ) : (
        t('common.na')
      ),
      Icon: <IconCart />,
      helpText: t('listing.detail.fieldPriceHelp'),
    },
    {
      key: t('listing.detail.fieldSize'),
      value: listing.size ? `${listing.size} m²` : t('common.na'),
      Icon: <IconExpand />,
      helpText: t('listing.detail.fieldSizeHelp'),
    },
    {
      key: t('listing.detail.fieldRooms'),
      value: listing.rooms ? t('listing.detail.fieldRoomsValue', { count: listing.rooms }) : t('common.na'),
      Icon: <IconGridView />,
      helpText: t('listing.detail.fieldRoomsHelp'),
    },
    {
      key: t('listing.detail.fieldJob'),
      value: listing.job_name,
      Icon: <IconBriefcase />,
      helpText: t('listing.detail.fieldJobHelp'),
    },
    {
      key: t('listing.detail.fieldProvider'),
      value: listing.provider ? listing.provider.charAt(0).toUpperCase() + listing.provider.slice(1) : 'Unknown',
      Icon: <IconBriefcase />,
      helpText: t('listing.detail.fieldProviderHelp'),
    },
    {
      key: t('listing.detail.fieldAdded'),
      value: timeService.format(listing.created_at, true, locale),
      Icon: <IconClock />,
      helpText: t('listing.detail.fieldAddedHelp'),
    },
  ];

  // Only the detail page states these, and only for a part of the listings, so they are pushed
  // rather than shown as another "N/A" next to the figures every listing carries.
  if (listing.build_year) {
    data.push({
      key: t('listing.detail.fieldBuildYear'),
      value: listing.build_year,
      Icon: <IconCalendar />,
      helpText: t('listing.detail.fieldBuildYearHelp'),
    });
  }

  if (listing.energy_class) {
    data.push({
      key: t('listing.detail.fieldEnergyClass'),
      value: listing.energy_class,
      Icon: <IconBolt />,
      helpText: t('listing.detail.fieldEnergyClassHelp'),
    });
  }

  const isRental = listing.dealType === 'rent';
  const scrollRoot = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.app__content');

  // The four reading anchors for the scrollspy rail. Order matches the page's top-to-bottom flow so
  // the rail reads as a table of contents. Ids are set on the matching <section> elements below.
  const scrollspySections: readonly ScrollspySection[] = [
    { id: 'listing-fit', label: t('listing.detail.tabFit'), icon: <IconBriefcase aria-hidden="true" /> },
    { id: 'listing-activity', label: t('listing.detail.tabActivity'), icon: <IconActivity aria-hidden="true" /> },
    { id: 'listing-map', label: t('listing.detail.tabMap'), icon: <IconMapPin aria-hidden="true" /> },
    { id: 'listing-evidence', label: t('listing.detail.tabEvidence'), icon: <IconClock aria-hidden="true" /> },
  ];

  return (
    <div className="listing-detail">
      <header className="listing-detail__heading">
        <div className="listing-detail__heading-copy">
          <span className="listing-detail__eyebrow">{t('listing.detail.eyebrow')}</span>
          <Title heading={1} className="listing-detail__heading-title">
            {listing?.title || t('listing.detail.defaultTitle')}
          </Title>
          <Text className="listing-detail__heading-description" type="tertiary">
            {t('listing.detail.headingDescription')}
          </Text>
        </div>
        <div className="listing-detail__heading-actions">
          <span
            className={`listing-detail__lifecycle${lifecycle !== 'new' ? ' listing-detail__lifecycle--selected' : ''}`}
          >
            {lifecycleLabel}
          </span>
          <Button
            icon={<IconArrowLeft />}
            onClick={() => (returnTo ? navigate(returnTo) : navigate(-1))}
            theme="borderless"
          >
            {t('listing.detail.back')}
          </Button>
        </div>
      </header>

      <ScrollspyTabs
        sections={scrollspySections}
        ariaLabel={t('listing.detail.sectionNav')}
        scrollRoot={scrollRoot}
        className="listing-detail__scrollspy"
      />

      <div className="listing-detail__mobile-action-dock" data-testid="listing-mobile-actions">
        {MOBILE_LISTING_ACTION_ORDER.map((action: 'apply' | 'maps' | 'provider') => {
          if (action === 'apply') {
            const applyButton = (
              <Button
                type="primary"
                theme="solid"
                className="listing-detail__mobile-apply"
                id={APPLIED_TRIGGER_ID}
                loading={inquirySending || draftLoading}
                disabled={
                  !listingApplied && (!inquiryEligibility.providerSupported || !inquiryEligibility.statusAllowsSend)
                }
                aria-label={listingApplied ? t('listing.detail.mobile.applied') : t(MOBILE_LISTING_ACTION_LABELS.apply)}
                onClick={handleMobileApply}
              >
                {listingApplied ? t('listing.detail.mobile.applied') : t(MOBILE_LISTING_ACTION_LABELS.apply)}
              </Button>
            );
            return applyNeedsConfirmation ? (
              <Popconfirm
                key={action}
                title={t('listing.detail.inquirySend.confirmTitle')}
                content={t('listing.detail.inquirySend.confirmBody')}
                onConfirm={handleSendInquiry}
              >
                {applyButton}
              </Popconfirm>
            ) : (
              <span key={action}>{applyButton}</span>
            );
          }

          if (action === 'maps') {
            return googleMapsUrl ? (
              <a
                key={action}
                className="listing-detail__mobile-icon-action"
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t(MOBILE_LISTING_ACTION_LABELS.maps)}
              >
                <IconMapPin aria-hidden="true" />
              </a>
            ) : (
              <Button
                key={action}
                className="listing-detail__mobile-icon-action"
                theme="light"
                disabled
                aria-label={t(MOBILE_LISTING_ACTION_LABELS.maps)}
              >
                <IconMapPin aria-hidden="true" />
              </Button>
            );
          }

          return providerListingUrl ? (
            <a
              key={action}
              className="listing-detail__mobile-icon-action"
              href={providerListingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t(MOBILE_LISTING_ACTION_LABELS.provider)}
            >
              <IconExternalOpen aria-hidden="true" />
            </a>
          ) : (
            <Button
              key={action}
              className="listing-detail__mobile-icon-action"
              theme="light"
              disabled
              aria-label={t(MOBILE_LISTING_ACTION_LABELS.provider)}
            >
              <IconExternalOpen aria-hidden="true" />
            </Button>
          );
        })}
      </div>

      {listingApplied && appliedPopoverOpen && (
        <div
          className="listing-detail__applied-popover"
          role="dialog"
          aria-label={t('listing.detail.mobile.appliedMessageTitle')}
        >
          <div className="listing-detail__applied-popover-header">
            <strong>{t('listing.detail.mobile.appliedMessageTitle')}</strong>
            <button
              ref={appliedCloseButtonRef}
              type="button"
              aria-label={t('listing.detail.mobile.closeAppliedMessage')}
              onClick={closeAppliedPopover}
            >
              ×
            </button>
          </div>
          <div className="listing-detail__applied-message">
            {appliedMessage ?? t('listing.detail.mobile.noSubmittedMessage')}
          </div>
        </div>
      )}

      <section className="listing-detail__composition" aria-label={t('listing.detail.compositionLabel')}>
        <main className="listing-detail__main">
          <section
            className="listing-detail__fit scrollspyTabs-section"
            id="listing-fit"
            aria-labelledby="listing-fit-heading"
          >
            <div
              className={`listing-detail__image-container${!listing.image_url ? ' listing-detail__image-container--placeholder' : ''}`}
            >
              <Image
                src={listing.image_url ?? no_image}
                fallback={<img src={no_image} alt={t('listing.detail.noImageAlt')} />}
                style={{ width: '100%', height: '100%' }}
                preview={!!listing.image_url}
              />
              {/* Photo-first hierarchy: the lifecycle badge floats over the image (mobile-first, per
              the frozen Direction A wireframe) so the state reads at a glance without a heading
              above the photo. It carries the shared fit-status contract - one lifecycle view, never
              a second boolean - and pairs an icon with the label so state is never colour-only. */}
              <span
                className={`listing-detail__image-badge listing-detail__fit-status${lifecycle !== 'new' ? ' listing-detail__fit-status--selected' : ''}`}
              >
                {lifecycleIcon}
                {lifecycleLabel}
              </span>
            </div>

            <div className="listing-detail__fit-summary">
              {/* The title lives in the desktop header H1; on mobile the header is photo-first and
              hides it, so this block carries the title and district below the photo instead. It is
              hidden on desktop to avoid repeating the H1 in the Fit card. */}
              <div className="listing-detail__fit-title">
                <span className="listing-detail__eyebrow">{t('listing.detail.fitEyebrow')}</span>
                <Title heading={2} id="listing-fit-heading">
                  {listing?.title || t('listing.detail.defaultTitle')}
                </Title>
              </div>
              <div className="listing-detail__fit-address">
                {' '}
                <Space align="center">
                  <IconMapPin style={{ fontSize: '18px', color: 'var(--semi-color-primary)' }} />
                  {listing.address ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="listing-detail__address-link"
                    >
                      {listing.address}
                    </a>
                  ) : (
                    <Text type="secondary">{t('listing.detail.noAddress')}</Text>
                  )}
                  <AddressEditor
                    isManual={listing.address_is_manual === 1}
                    onSave={saveAddress}
                    onPickOnMap={startPinDrop}
                  />
                </Space>
              </div>
              <div className="listing-detail__fit-metric listing-detail__fit-metric--travel">
                <span>{t('listing.detail.travelLabel')}</span>
                <strong className="listing-detail__fit-metric-value--accent">
                  {primaryTravel
                    ? primaryTravel.distance
                      ? t('listing.detail.travelSummary', {
                          duration: primaryTravel.duration,
                          distance: primaryTravel.distance,
                          label: primaryTravel.label,
                        })
                      : [primaryTravel.duration, primaryTravel.label].filter(Boolean).join(' · ')
                    : t('common.na')}
                </strong>
              </div>

              {/* Lifecycle controls stay above secondary facts so they remain visible above the
              fixed mobile action dock. Each pairs an icon with its label and reflects the current
              state: the current forward action is hidden; archived exposes restore and disables
              the forward transitions. */}
              <div
                className="listing-detail__fit-lifecycle"
                role="group"
                aria-label={t('listing.detail.mobile.lifecycleActions')}
              >
                {listingArchived ? (
                  <>
                    <Button icon={<IconUndo />} theme="solid" type="primary" onClick={handleUnarchive}>
                      {t('listing.detail.mobile.unarchive')}
                    </Button>
                    <Button icon={<IconTickCircle />} disabled>
                      {t('home.activityApplied')}
                    </Button>
                    <Button icon={<IconEyeOpened />} disabled>
                      {t('home.activityViewed')}
                    </Button>
                  </>
                ) : (
                  <>
                    {!listingApplied && (
                      <Button icon={<IconTickCircle />} onClick={handleManualApply}>
                        {t('listing.detail.mobile.appliedSelf')}
                      </Button>
                    )}
                    {!listingViewed && (
                      <Button icon={<IconEyeOpened />} onClick={handleViewing}>
                        {t('listing.detail.mobile.viewing')}
                      </Button>
                    )}
                    <Button icon={<IconArchive />} onClick={handleArchive}>
                      {t('listing.detail.mobile.archive')}
                    </Button>
                  </>
                )}
              </div>

              <div className="listing-detail__fit-metrics">
                <div className="listing-detail__fit-metric">
                  <span>{t('listing.detail.fieldPrice')}</span>
                  <strong>{listing.price ? formatEuroPrice(listing.price, locale) : t('common.na')}</strong>
                </div>
                <div className="listing-detail__fit-metric">
                  <span>{t('listing.detail.fieldSize')}</span>
                  <strong>{listing.size ? `${listing.size} m²` : t('common.na')}</strong>
                </div>
                <div className="listing-detail__fit-metric">
                  <span>{t('listing.detail.fieldRooms')}</span>
                  <strong>
                    {listing.rooms ? t('listing.detail.fieldRoomsValue', { count: listing.rooms }) : t('common.na')}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          <section
            className="listing-detail__activity scrollspyTabs-section"
            id="listing-activity"
            aria-labelledby="listing-activity-heading"
          >
            <div className="listing-detail__section-heading">
              <div>
                <span className="listing-detail__eyebrow">{t('listing.detail.activityEyebrow')}</span>
                <Title heading={3} id="listing-activity-heading">
                  {t('listing.detail.activityTitle')}
                </Title>
              </div>
              <Text type="tertiary">{t('listing.detail.activityDescription')}</Text>
            </div>
            <div className="listing-detail__activity-content">
              <div className="listing-detail__notes" ref={notesSectionRef}>
                <Title heading={4} className="listing-detail__notes-title">
                  {t('listing.detail.notesTitle')}
                </Title>
                <TextArea
                  ref={notesInputRef}
                  value={notesDraft}
                  onChange={(val) => setNotesDraft(val)}
                  placeholder={t('listing.detail.notesPlaceholder')}
                  rows={5}
                  autosize={{ minRows: 4, maxRows: 12 }}
                  className="listing-detail__notes-textarea"
                  showClear
                />
                <Space className="listing-detail__notes-actions">
                  <Button
                    theme="solid"
                    type="primary"
                    loading={notesSaving}
                    disabled={notesSaving || (notesDraft ?? '') === (listing.notes ?? '')}
                    onClick={handleSaveNotes}
                  >
                    {t('listing.detail.storeNotes')}
                  </Button>
                </Space>
              </div>
              <div
                className="listing-detail__lifecycle-actions"
                role="group"
                aria-label={t('listing.detail.mobile.lifecycleActions')}
              >
                {listingArchived ? (
                  <>
                    <Button icon={<IconUndo />} theme="solid" type="primary" onClick={handleUnarchive}>
                      {t('listing.detail.mobile.unarchive')}
                    </Button>
                    {/* Archived is a resting state: the forward lifecycle actions are unavailable
                    until the listing is restored, so they render disabled rather than vanishing. */}
                    <Button icon={<IconTickCircle />} disabled>
                      {t('listing.detail.mobile.appliedSelf')}
                    </Button>
                    <Button icon={<IconEyeOpened />} disabled>
                      {t('listing.detail.mobile.viewing')}
                    </Button>
                  </>
                ) : (
                  <>
                    {!listingApplied && (
                      <Button icon={<IconTickCircle />} onClick={handleManualApply}>
                        {t('listing.detail.mobile.appliedSelf')}
                      </Button>
                    )}
                    {!listingViewed && (
                      <Button icon={<IconEyeOpened />} onClick={handleViewing}>
                        {t('listing.detail.mobile.viewing')}
                      </Button>
                    )}
                    <Button icon={<IconArchive />} onClick={handleArchive}>
                      {t('listing.detail.mobile.archive')}
                    </Button>
                  </>
                )}
                <Button aria-label={t('listing.detail.mobile.addNotes')} onClick={focusNotes}>
                  {t('listing.detail.mobile.addNotes')}
                </Button>
              </div>
            </div>
          </section>

          <section
            className="listing-detail__evidence scrollspyTabs-section"
            id="listing-evidence"
            aria-labelledby="listing-evidence-heading"
          >
            <div className="listing-detail__section-heading">
              <div>
                <span className="listing-detail__eyebrow">{t('listing.detail.evidenceEyebrow')}</span>
                <Title heading={3} id="listing-evidence-heading">
                  {t('listing.detail.evidenceTitle')}
                </Title>
              </div>
              <Text type="tertiary">{t('listing.detail.evidenceDescription')}</Text>
            </div>
            <div className="listing-detail__deep-grid">
              <section className="listing-detail__deep-column">
                {/* The map used to run the full width under the card, which pushed it a screen
                below the figures. In this column it sits beside the details and the costing,
                so the whole listing fits on one screen. */}
                <div className="listing-detail__map-wrapper scrollspyTabs-section" id="listing-map">
                  <Title heading={4} className="listing-detail__map-title">
                    {t('listing.detail.locationTitle')}
                  </Title>
                  {/* A listing with no coordinates normally gets a warning instead of a map - but those
                  are exactly the ones somebody wants to place by hand, so pin dropping brings the
                  map out anyway. */}
                  {!hasGeo && !pinDrop ? (
                    <Banner
                      type="warning"
                      bordered
                      description={
                        <div className="listing-detail__noGeo">
                          <span>
                            {geoUnresolved ? t('listing.detail.noGeoWarning') : t('listing.detail.noGeoPending')}
                          </span>
                          {/* Only for the temporary case. Offering "try again" for an address the
                          geocoder has already rejected would be offering the same answer twice. */}
                          {!geoUnresolved && (
                            <Button size="small" loading={geocodeRetrying} onClick={retryGeocoding}>
                              {t('listing.detail.geoRetry')}
                            </Button>
                          )}
                        </div>
                      }
                    />
                  ) : (
                    <div className="listing-detail__map-container">
                      {/* Public transport on by default: the first question about any flat is how to
                      get out of it, and the answer should already be on screen. */}
                      <MapCanvas
                        countries={countries}
                        initialCenter={mapCenter}
                        initialZoom={hasGeo ? 14 : 10}
                        defaultShowTransit
                        cooperativeGestures
                        expanded={mapExpanded}
                        onExpandedChange={setMapExpanded}
                        pickMode={pinDrop != null}
                        onPick={setPickedCoords}
                        onMapReady={handleMapReady}
                      >
                        {pinDrop != null && (
                          <div className="listing-detail__pin-bar">
                            <div className="listing-detail__pin-bar-text">
                              <Text>
                                {pickedCoords ? t('listing.detail.pinDropPicked') : t('listing.detail.pinDropHint')}
                              </Text>
                              <Text type="tertiary" size="small">
                                {pinDrop.address}
                              </Text>
                            </div>
                            <Button
                              theme="solid"
                              type="primary"
                              size="small"
                              disabled={!pickedCoords}
                              loading={pinSaving}
                              onClick={savePinnedAddress}
                            >
                              {t('listing.detail.pinDropSave')}
                            </Button>
                            <Button size="small" theme="borderless" onClick={cancelPinDrop}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        )}
                      </MapCanvas>
                    </div>
                  )}
                </div>

                {/* "How do I get out of here?" belongs right next to the map, and only makes sense
                once the listing has coordinates to look up. */}
                {hasGeo && (
                  <div className="listing-detail__transit">
                    <Title heading={4} className="listing-detail__map-title">
                      {t('transit.nearbyTitle')}
                    </Title>
                    <NearbyStops lat={listing.latitude!} lng={listing.longitude!} limit={3} expandFirst />
                  </div>
                )}
              </section>
              <section className="listing-detail__deep-column">
                <div className="listing-detail__info-section">
                  <Title heading={4} style={{ marginBottom: '1rem' }}>
                    {t('listing.detail.detailsTitle')}
                  </Title>
                  <Descriptions column={1}>
                    {data.map((item, index) => (
                      <Descriptions.Item key={index}>
                        <Tooltip content={item.helpText} position="left">
                          <span className="listing-detail__details-item">
                            {item.Icon}
                            {item.value}
                          </span>
                        </Tooltip>
                      </Descriptions.Item>
                    ))}
                  </Descriptions>

                  {/* Directly under the figures it explains. The chart hides itself below two
                  readings, so a listing whose price has never moved shows nothing at all rather
                  than an empty frame. */}
                  {priceHistory.length >= 2 && (
                    <>
                      <Divider margin="1.5rem" />
                      <Title heading={6} style={{ marginBottom: '0.75rem' }}>
                        {t('listing.detail.priceHistory')}
                      </Title>
                      <PriceHistoryChart data={priceHistory} locale={locale} />
                    </>
                  )}

                  {/* The costing answers "can I have this?", which is the question asked right
                  after the price - so it comes before the sales copy, not after it. */}
                  {(() => {
                    // The finance card only computes with a numeric price; a null/absent price
                    // makes it render nothing anyway, so match that by not mounting it.
                    const financePrice = typeof listing.price === 'number' ? listing.price : Number(listing.price);
                    return Number.isFinite(financePrice) ? (
                      <ListingFinanceCard
                        listing={{ id: listing.id, price: financePrice, dealType: listing.dealType }}
                      />
                    ) : null;
                  })()}

                  {/* Without the matching half of the profile there is nothing to compute, so offer
                  the way to create it instead of hiding the feature completely. */}
                  {!(isRental ? rentComplete : buyComplete) && listing.price != null && (
                    <>
                      <Divider margin="1.5rem" />
                      <Space align="center" wrap>
                        <IconEuro style={{ fontSize: '18px', color: 'var(--semi-color-primary)' }} />
                        <Text type="secondary">
                          {t(isRental ? 'listing.detail.rentSetupHint' : 'listing.detail.financeSetupHint')}
                        </Text>
                        <Button
                          theme="borderless"
                          size="small"
                          onClick={() =>
                            navigate(
                              isRental
                                ? '/finance'
                                : `/finance?dealType=buy&price=${listing.price}&listingId=${listing.id}`,
                            )
                          }
                        >
                          {t(isRental ? 'listing.detail.rentSetup' : 'listing.detail.financeCalculate')}
                        </Button>
                      </Space>
                    </>
                  )}

                  <Divider margin="1.5rem" />
                  <Title heading={4} style={{ marginBottom: '1rem' }}>
                    {t('listing.detail.descriptionTitle')}
                  </Title>
                  <Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                    {listing.description || t('listing.detail.noDescription')}
                  </Text>

                  {Array.isArray(listing.distances) && listing.distances.length > 0 && (
                    <>
                      <Divider margin="1.5rem" />
                      <Space align="center" wrap>
                        <IconActivity style={{ fontSize: '18px', color: 'var(--semi-color-primary)' }} />
                        <Text strong>{t('listing.detail.distanceToHome')}</Text>
                        {listing.distances.map((d) => (
                          <Tag color="blue" key={d.label}>
                            {d.label}: {d.meters} m
                          </Tag>
                        ))}
                      </Space>
                    </>
                  )}

                  {/* Right below the straight-line distances, because the two answer the same question
                  and the second one is the honest answer. It loads on its own: a listing found
                  minutes ago has not been routed yet, and this is where somebody would look. */}
                  {listing.latitude != null && listing.longitude != null && (
                    <>
                      <Divider margin="1.5rem" />
                      <Text strong style={{ display: 'block', marginBottom: '0.5rem' }}>
                        {t('travelTime.title')}
                      </Text>
                      <TravelTimes
                        listingId={listing.id}
                        travelTimes={listing.travelTimes}
                        refine
                        onLoaded={(entries) => setRouteTimes(entries)}
                      />

                      {/* Sits under the times rather than on the map: it is the same question the
                      numbers above answer, only drawn. A mode with no route stored falls back to
                      the straight line, and says so. */}
                      <div className="listingDetail__routePicker">
                        <Text size="small" type="tertiary">
                          {t('listing.detail.routeLabel')}
                        </Text>
                        <Select
                          size="small"
                          style={{ width: 170 }}
                          value={routeMode}
                          onChange={(value) => {
                            if (
                              typeof value === 'string' &&
                              ['straight', 'transit', 'car', 'bike', 'walk'].includes(value)
                            ) {
                              setRouteMode(value as RouteMode);
                            }
                          }}
                        >
                          <Select.Option value="straight">{t('listing.detail.routeStraight')}</Select.Option>
                          {TRAVEL_MODES.map((mode: { key: string; icon: string; labelKey: string }) => (
                            <Select.Option key={mode.key} value={mode.key}>
                              {mode.icon} {t(mode.labelKey)}
                            </Select.Option>
                          ))}
                        </Select>
                        {routeMode !== 'straight' && !hasRouteFor(routeTimes, routeMode) && (
                          <Text size="small" type="tertiary">
                            {t('listing.detail.routeMissing')}
                          </Text>
                        )}
                      </div>
                    </>
                  )}

                  {/* Under the travel times because it belongs to the same half of the page: both are
                  things Fredy worked out about the address rather than things the portal said about
                  the flat, and somebody weighing up a place reads them together. Only shown once
                  the operator has the enrichment on - with it off nothing is ever stored, and an
                  empty card would read as a fault rather than a setting. */}
                  {hasGeo && connectivityEnabled && (
                    <>
                      <Divider margin="1.5rem" />
                      <Text strong style={{ display: 'block', marginBottom: '0.5rem' }}>
                        {t('connectivity.title')}
                      </Text>
                      <ConnectivityCard connectivity={listing.connectivity} />
                    </>
                  )}
                </div>
              </section>
            </div>
          </section>
        </main>

        <aside className="listing-detail__action-rail" aria-labelledby="listing-action-heading">
          <div className="listing-detail__rail-heading">
            <span className="listing-detail__eyebrow">{t('listing.detail.actionEyebrow')}</span>
            <Title heading={3} id="listing-action-heading">
              {t('listing.detail.actionTitle')}
            </Title>
            <Text type="tertiary">{t('listing.detail.actionDescription')}</Text>
          </div>
          <div className="listing-detail__action-rail-body">
            <div className="listing-detail__rail-primary-action">
              {listingApplied ? (
                <Button type="primary" theme="solid" disabled>
                  {t('listing.detail.mobile.applied')}
                </Button>
              ) : applyNeedsConfirmation ? (
                <Popconfirm
                  title={t('listing.detail.inquirySend.confirmTitle')}
                  content={t('listing.detail.inquirySend.confirmBody')}
                  onConfirm={handleSendInquiry}
                >
                  <Button type="primary" theme="solid" loading={inquirySending}>
                    {t('listing.detail.mobile.apply')}
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  theme="solid"
                  loading={inquirySending || draftLoading}
                  disabled={!inquiryEligibility.providerSupported || !inquiryEligibility.statusAllowsSend}
                  onClick={handleMobileApply}
                >
                  {t('listing.detail.mobile.apply')}
                </Button>
              )}
            </div>
            <div className="listing-detail__guard" role="note">
              <strong>{t('listing.detail.actionGuardTitle')}</strong>
              <Text type="tertiary">{t('listing.detail.actionGuardDescription')}</Text>
            </div>
            <Space wrap className="listing-detail__rail-actions">
              <Button
                icon={draftMessage ? <IconRefresh /> : <IconEdit />}
                onClick={handleDraftMessage}
                theme="light"
                type="tertiary"
                loading={draftLoading}
              >
                {draftLoading
                  ? t('listing.detail.draftMessage.generating')
                  : draftMessage
                    ? t('listing.detail.draftMessage.regenerate')
                    : t('listing.detail.draftMessage.button')}
              </Button>
              <a
                href={providerListingUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="listing-detail__open-btn"
                aria-disabled={!providerListingUrl}
                onClick={(event) => {
                  if (!providerListingUrl) event.preventDefault();
                }}
              >
                <IconExternalOpen style={{ marginRight: 6 }} />
                {t('listing.detail.openListing')}
              </a>
              {/* Sits next to "open listing" on purpose: the user clicks that first, sees the ad is
                very much alive, and the correction is the next button along. */}
              {listing.is_active === 0 && (
                <Button icon={<IconRefresh />} onClick={handleReactivate} theme="light" type="secondary">
                  {t('listing.detail.reactivate')}
                </Button>
              )}
            </Space>

            {/* Draft inquiry message result */}
            {(draftMessage || draftError || canApplyWithoutMessage || listing.inquiry_send_status) && (
              <div style={{ marginTop: 12, maxWidth: 600 }}>
                {draftError && (
                  <Banner type="warning" description={draftError} closeIcon={null} style={{ marginBottom: 8 }} />
                )}
                {(draftMessage || canApplyWithoutMessage || listing.inquiry_send_status) && (
                  <div>
                    {draftMessage && (
                      <TextArea
                        value={draftMessage}
                        onChange={(value) => setDraftMessage(value)}
                        disabled={listing.inquiry_send_status === 'sending'}
                        autosize={{ minRows: 4, maxRows: 12 }}
                        style={{ marginBottom: 8 }}
                      />
                    )}
                    <Space wrap>
                      {draftMessage && (
                        <Button icon={<IconCopy />} onClick={handleCopyDraft} size="small" theme="light">
                          {draftCopied
                            ? t('listing.detail.draftMessage.copied')
                            : t('listing.detail.draftMessage.copy')}
                        </Button>
                      )}
                      {inquiryEligibility.providerSupported &&
                        inquiryEligibility.statusAllowsSend &&
                        (inquiryEligibility.canSend ? (
                          <Popconfirm
                            title={t('listing.detail.inquirySend.confirmTitle')}
                            content={t('listing.detail.inquirySend.confirmBody')}
                            onConfirm={handleSendInquiry}
                          >
                            <Button icon={<IconSend />} size="small" theme="solid" loading={inquirySending}>
                              {t('listing.detail.inquirySend.button', { provider: inquiryProviderName })}
                            </Button>
                          </Popconfirm>
                        ) : !inquiryEligibility.profileReady ? (
                          <Button
                            icon={<IconEdit />}
                            size="small"
                            theme="light"
                            onClick={() => navigate('/settings/inquiry-profile')}
                          >
                            {t('listing.detail.inquirySend.completeProfile')}
                          </Button>
                        ) : null)}
                      {listing.inquiry_send_status && (
                        <Tag
                          color={
                            listing.inquiry_send_status === 'sent'
                              ? 'green'
                              : listing.inquiry_send_status === 'sending'
                                ? 'blue'
                                : 'orange'
                          }
                        >
                          {t(`listing.detail.inquirySend.status.${listing.inquiry_send_status}`)}
                        </Tag>
                      )}
                    </Space>
                    {listing.inquiry_send_status === 'failed' && (
                      <Banner
                        type="warning"
                        description={t('listing.detail.inquirySend.failedWarning')}
                        closeIcon={null}
                        style={{ marginTop: 8 }}
                      />
                    )}
                    {listing.inquiry_send_status === 'unknown' && (
                      <Banner
                        type="warning"
                        description={t('listing.detail.inquirySend.unknownWarning')}
                        closeIcon={null}
                        style={{ marginTop: 8 }}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
