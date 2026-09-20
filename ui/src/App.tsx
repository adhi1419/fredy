/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { useEffect } from 'react';
import type { ComponentProps, ComponentType, PropsWithChildren } from 'react';

import InsufficientPermission from './components/permission/InsufficientPermission';
import PermissionAwareRoute from './components/permission/PermissionAwareRoute';
import SettingsLayout from './views/settings/SettingsLayout';
import PreferencesPage from './views/settings/pages/PreferencesPage';
import TravelTimePage from './views/settings/pages/TravelTimePage';
import ListingDetailsPage from './views/settings/pages/ListingDetailsPage';
import NotificationsPage from './views/settings/pages/NotificationsPage';
import InquiryProfilePage from './views/settings/pages/InquiryProfilePage';
import AdminLayout from './views/admin/AdminLayout';
import SystemPage from './views/admin/pages/SystemPage';
import ExecutionPage from './views/admin/pages/ExecutionPage';
import ConnectivityPage from './views/admin/pages/ConnectivityPage';
import BackupPage from './views/admin/pages/BackupPage';
import DebugPage from './views/admin/pages/DebugPage';
import JobMutation from './views/jobs/mutation/JobMutation';
import { useActions, useSelector } from './services/state/store.js';
import { useBrowserNotifications } from './hooks/useBrowserNotifications';
import { Routes, Route, Navigate, useLocation } from 'react-router';
import Login from './views/login/Login';
import Jobs from './views/jobs/Jobs';

import './App.less';
import { LocaleProvider } from '@douyinfe/semi-ui-19';
import Listings from './views/listings/Listings.jsx';
import MapView from './views/listings/Map.jsx';
import Navigation from './components/navigation/Navigation.js';
import { Layout } from '@douyinfe/semi-ui-19';
import FredyFooter from './components/footer/FredyFooter.jsx';
import Home from './views/home/Home';
import FinanceCalculator from './views/finance/FinanceCalculator.jsx';
import ListingDetail from './views/listings/ListingDetail.js';
import { I18nProvider, availableLanguages } from './services/i18n/i18n.jsx';
import DebugLoggingBanner from './components/debug/DebugLoggingBanner.jsx';
import DemoBanner from './components/demo/DemoBanner.jsx';
import { LEGACY_REDIRECTS } from './services/routes/legacyRedirects.js';
import { applyTheme, normalizeTheme } from './services/theme/theme.js';
import { signOutFirebase, subscribeToAuthState } from './services/auth/firebaseAuth.js';
import ApplicantProfileOnboardingPage from './views/onboarding/ApplicantProfileOnboardingPage.jsx';
import {
  APPLICANT_PROFILE_ONBOARDING_PATH,
  resolveApplicantProfileOnboarding,
} from './services/onboarding/applicantProfileOnboarding.js';

interface FredyUser {
  userId?: string;
  username?: string;
  isAdmin?: boolean;
}

interface FredyState {
  user: { currentUser: FredyUser | null };
  generalSettings: { settings: { demoMode?: boolean } };
  userSettings: {
    loaded: boolean;
    loadFailed: boolean;
    settings: { language?: string; theme?: unknown; inquiry_profile?: unknown };
  };
}

interface FredyActions {
  user: { getCurrentUser(): Promise<FredyUser | null>; resetCurrentUser(): void };
  provider: { getProvider(): Promise<unknown> };
  jobsData: { getJobs(): Promise<unknown>; getSharableUserList(): Promise<unknown> };
  notificationAdapter: { getAdapter(): Promise<unknown> };
  generalSettings: { getGeneralSettings(): Promise<unknown> };
  userSettings: { getUserSettings(): Promise<unknown> };
  finance: { getProfileSummary(): Promise<unknown> };
}

type SemiLocale = NonNullable<ComponentProps<typeof LocaleProvider>['locale']>;
type ContentProps = PropsWithChildren<{ className?: string; id?: string; tabIndex?: number }>;

const semiLocaleModules = import.meta.glob<unknown>('/node_modules/@douyinfe/semi-ui-19/lib/es/locale/source/*.js', {
  eager: true,
});

const semiLocales: Record<string, SemiLocale> = {};
for (const [path, moduleValue] of Object.entries(semiLocaleModules)) {
  const name = path.match(/\/source\/(\w+)\.js$/)?.[1];
  const loaded = moduleValue as { default?: SemiLocale };
  if (name) semiLocales[name] = loaded.default ?? (moduleValue as SemiLocale);
}

export default function FredyApp() {
  const location = useLocation();
  const actions = useActions<FredyActions>();
  const [loading, setLoading] = React.useState(true);
  /** userId the stores were actually filled for. Only set once the requests have landed. */
  const initializedFor = React.useRef<string | null>(null);
  /**
   * Whether a fill is in flight.
   *
   * The effect runs twice on a hard refresh - once on mount, once when the user lands in the
   * store - and without this the second run saw the ref already set, dropped `loading`, and
   * rendered the route while the first run was still fetching. Anything that seeds its state
   * from a store slice on mount (the job editor's twelve fields, view-mode toggles) then kept
   * the empty values it saw and never recovered.
   */
  const initInFlight = React.useRef(false);
  const currentUser = useSelector<FredyState, FredyUser | null>((state) => state.user.currentUser);
  const settings = useSelector<FredyState, FredyState['generalSettings']['settings']>(
    (state) => state.generalSettings.settings,
  );
  const userSettings = useSelector<FredyState, FredyState['userSettings']>((state) => state.userSettings);
  const language = useSelector<FredyState, string | undefined>((state) => state.userSettings.settings.language);
  /*
   * Straight off the user's stored settings, with nothing cached in front of it. Until those have
   * arrived - on the login screen, and for the moment a cold load spends fetching them - this is
   * the default, which is also what index.html ships on the body, so nothing repaints.
   */
  const theme = normalizeTheme(useSelector<FredyState, unknown>((state) => state.userSettings.settings.theme));

  useBrowserNotifications();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // Already filled for this user: nothing to do. Checked against the ref, which is only set
    // after the requests resolved, so this cannot short-circuit a fill that is still running.
    if (currentUser?.userId != null && initializedFor.current === currentUser.userId) {
      setLoading(false);
      return;
    }

    async function init() {
      // A second run must not race the first one to `setLoading(false)`.
      if (initInFlight.current) {
        return;
      }
      initInFlight.current = true;
      try {
        // Judge on the user this call just returned, not on the one in the render closure: on a
        // hard refresh that closure is still null, so the guard below used to skip every load,
        // drop `loading`, and render the whole app against empty stores. Anything that seeds
        // component state from settings on mount (the finance calculator, view-mode toggles)
        // then kept the blank values it saw.
        let user = null;
        try {
          user = await actions.user.getCurrentUser();
        } catch {
          // No restored/approved Firebase identity: render the login route.
        }
        const userId = user?.userId ?? null;

        if (userId == null) {
          initializedFor.current = null;
          setLoading(false);
          return;
        }

        if (initializedFor.current !== userId) {
          // These are independent of each other, so they go out together. Awaiting them one after
          // the other meant nine serial round trips before the first pixel.
          await Promise.all([
            actions.provider.getProvider(),
            actions.jobsData.getJobs(),
            actions.jobsData.getSharableUserList(),
            actions.notificationAdapter.getAdapter(),
            actions.generalSettings.getGeneralSettings(),
            actions.userSettings.getUserSettings(),
            // Powers every finance surface; derived server-side so the browser holds no such math.
            actions.finance.getProfileSummary(),
          ]);
          // Marked done only now: a route that seeds its state from the store on mount must not
          // be rendered before the store actually holds it.
          initializedFor.current = userId;
        }

        setLoading(false);
      } finally {
        initInFlight.current = false;
      }
    }

    init();
  }, [currentUser?.userId]);

  // A Firebase state change to null is authoritative for logout, including logout in another tab.
  useEffect(() => {
    return subscribeToAuthState((firebaseUser) => {
      if (!firebaseUser) actions.user.resetCurrentUser();
    });
  }, [actions]);

  // When any request reports a 401, drop the Firebase auth state and cached user. That flips
  // needsLogin() to true, so the router shows the login screen instead of leaving stale data open.
  useEffect(() => {
    const onUnauthorized = () => {
      void signOutFirebase()
        .catch(() => {})
        .finally(() => actions.user.resetCurrentUser());
    };
    window.addEventListener('fredy:unauthorized', onUnauthorized);
    return () => window.removeEventListener('fredy:unauthorized', onUnauthorized);
  }, [actions]);

  const needsLogin = () => {
    return currentUser == null || Object.keys(currentUser).length === 0;
  };
  const semiLocaleKey = availableLanguages.find((option) => option.code === (language ?? 'en'))?.semiLocale ?? 'en_US';

  const isAdmin = () => currentUser?.isAdmin === true;
  const onboardingDecision = resolveApplicantProfileOnboarding({
    settingsLoaded: userSettings.loaded,
    settingsLoadFailed: userSettings.loadFailed,
    profile: userSettings.settings?.inquiry_profile,
    pathname: location.pathname,
  });
  const Content = Layout.Content as ComponentType<ContentProps>;
  return loading ? null : (
    <I18nProvider language={language ?? 'en'}>
      <LocaleProvider locale={semiLocales[semiLocaleKey] ?? semiLocales.en_US}>
        {needsLogin() ? (
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate state={{ from: location }} to="/login" replace />} />
          </Routes>
        ) : (
          // Keyed on the theme so everything below remounts when it changes. The stylesheets follow the
          // body attribute on their own, but the charts paint onto a canvas from colours they read once
          // per render, and a canvas keeps whatever it was last painted with until something redraws it.
          <Layout className="app" key={theme}>
            <Navigation
              currentUser={currentUser}
              isAdmin={isAdmin()}
              primaryVisible={!onboardingDecision.requiresSetup}
            />
            <Layout className="app__main">
              <Content className="app__content" id="fredy-main-content" tabIndex={-1}>
                <DebugLoggingBanner />
                {settings.demoMode && <DemoBanner />}
                <Routes>
                  {onboardingDecision.requiresSetup ? (
                    <>
                      <Route path={APPLICANT_PROFILE_ONBOARDING_PATH} element={<ApplicantProfileOnboardingPage />} />
                      <Route
                        path="*"
                        element={<Navigate to={APPLICANT_PROFILE_ONBOARDING_PATH} state={{ from: location }} replace />}
                      />
                    </>
                  ) : (
                    <>
                      <Route path={APPLICANT_PROFILE_ONBOARDING_PATH} element={<Navigate to="/dashboard" replace />} />
                      <Route path="/403" element={<InsufficientPermission />} />
                      <Route path="/jobs/new" element={<JobMutation />} />
                      <Route path="/jobs/edit/:jobId" element={<JobMutation />} />
                      <Route path="/dashboard" element={<Home />} />
                      <Route path="/jobs" element={<Jobs />} />
                      <Route path="/listings" element={<Listings />} />
                      <Route path="/listings/listing/:listingId" element={<ListingDetail />} />
                      <Route path="/map" element={<MapView />} />
                      <Route path="/finance" element={<FinanceCalculator />} />

                      {/* Settings that belong to whoever is signed in. No guard: they are theirs.
                      One entry in the account menu, and the section rail below the compact heading is
                      the only place these five pages are named. */}
                      <Route path="/settings" element={<SettingsLayout />}>
                        <Route index element={<Navigate to="/settings/preferences" replace />} />
                        <Route path="preferences" element={<PreferencesPage />} />
                        <Route path="travel-time" element={<TravelTimePage />} />
                        <Route path="listings" element={<ListingDetailsPage />} />
                        <Route path="notifications" element={<NotificationsPage />} />
                        <Route path="inquiry-profile" element={<InquiryProfilePage />} />
                      </Route>

                      {/* Settings that belong to the instance. Guarded once, at the parent, so a new
                      page cannot be added without inheriting the check. */}
                      <Route
                        path="/admin"
                        element={
                          <PermissionAwareRoute currentUser={currentUser}>
                            <AdminLayout />
                          </PermissionAwareRoute>
                        }
                      >
                        <Route index element={<Navigate to="/admin/system" replace />} />
                        <Route path="system" element={<SystemPage />} />
                        <Route path="execution" element={<ExecutionPage />} />
                        <Route path="connectivity" element={<ConnectivityPage />} />
                        <Route path="backup" element={<BackupPage />} />
                        <Route path="debug" element={<DebugPage />} />
                      </Route>

                      {/* The addresses these things used to live at, kept so existing bookmarks and the
                      links in older notification emails still land somewhere sensible. The table
                      lives in legacyRedirects.js so a test can check every entry still resolves. */}
                      {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
                        <Route key={from} path={from} element={<Navigate to={to} replace />} />
                      ))}
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      {/* Catch-all: an authenticated user landing on an unknown path (e.g. still on
                      /login during the post-login transition) is sent to the dashboard instead
                      of matching no route. */}
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </>
                  )}
                </Routes>
              </Content>
              <FredyFooter />
            </Layout>
          </Layout>
        )}
      </LocaleProvider>
    </I18nProvider>
  );
}

FredyApp.displayName = 'FredyApp';
