/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const packageJson = JSON.parse(read('package.json'));

function workflowJob(workflow, job, nextJob) {
  const start = workflow.indexOf(`  ${job}:\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = nextJob == null ? workflow.length : workflow.indexOf(`  ${nextJob}:\n`, start);
  return workflow.slice(start, end);
}

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  });
}

describe('Bun and TypeScript foundation', () => {
  it('pins Bun and frontend tooling exactly', () => {
    expect(read('.bun-version').trim()).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [dependency, version] of Object.entries(packageJson.devDependencies)) {
      expect(version, dependency).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('keeps the typed seam narrow and strict', () => {
    const config = JSON.parse(read('tsconfig.frontend.json'));
    expect(config.compilerOptions.strict).toBe(true);
    expect(config.compilerOptions.noEmit).toBe(true);
    expect(config.compilerOptions.allowJs).toBe(false);
    expect(packageJson.scripts['typecheck:frontend']).toContain('tsconfig.frontend.json');
    expect(packageJson.scripts['typecheck:frontend']).toContain('tsconfig.frontend-tests.json');
    expect(config.include).toEqual([
      'ui/src/services/apiUrl.ts',
      'ui/src/services/jobs/guidedSearchForm.ts',
      'ui/src/services/jobs/jobValidation.ts',
      'ui/src/services/dashboard/attention.ts',
      'ui/src/services/jobs/dealType.ts',
      'ui/src/services/jobs/jobDraft.ts',
      'ui/src/services/jobs/jobSummary.ts',
      'ui/src/services/jobs/jobFilters.ts',
      'ui/src/services/auth/firebaseAuth.ts',
      'ui/src/services/authenticatedTransport.ts',
      'ui/src/services/jobs/providerUrl.ts',
      'ui/src/services/home/homeViewState.ts',
      'ui/src/views/listings/mapUtils.ts',
      'ui/src/App.tsx',
      'ui/src/components/navigation/Navigation.tsx',
      'ui/src/components/navigation/navModel.ts',
      'ui/src/views/home/Home.tsx',
      'ui/src/views/listings/ListingDetail.tsx',
      'ui/src/services/listings/listingFilters.ts',
      'ui/src/services/state/financeState.ts',
      'ui/src/services/state/jobsState.ts',
      'ui/src/services/state/listingsState.ts',
      'ui/src/services/state/notificationState.ts',
      'ui/src/services/state/userSettingsState.ts',
      'ui/src/views/jobs/Jobs.tsx',
      'ui/src/views/jobs/SavedSearchesIndex.tsx',
      'ui/src/views/jobs/savedSearchActions.ts',
      'ui/src/views/jobs/savedSearchesLegacy.d.ts',
      'ui/src/views/settings/SettingsLayout.tsx',
      'ui/src/views/settings/pages/PreferencesPage.tsx',
      'ui/src/views/settings/pages/ListingDetailsPage.tsx',
      'ui/src/views/settings/pages/personalSettingsDrafts.ts',
      'ui/src/components/myAccountWireframe/MyAccountWireframeMenu.tsx',
      'ui/src/vite-env.d.ts',
      'ui/src/services/onboarding/applicantProfileOnboarding.ts',
      'ui/src/services/routes/legacyRedirects.ts',
      'ui/src/services/theme/theme.ts',
      'ui/src/hooks/useBrowserNotifications.ts',
      'ui/src/services/finance/constants.ts',
      'ui/src/services/price/priceService.ts',
      'ui/src/types/finance.ts',
      'ui/src/services/providerOrder.ts',
      'ui/src/hooks/useControllableState.ts',
      'ui/src/hooks/useProviderCountries.ts',
      'ui/src/hooks/useFinanceProfile.ts',
      'ui/src/components/cards/chartTheme.ts',
      'ui/src/components/cards/KpiCard.tsx',
      'ui/src/components/cards/ProviderShareChart.tsx',
      'ui/src/components/cards/TrendSparkline.tsx',
      'ui/src/views/finance/FinanceCalculator.tsx',
      'ui/src/views/finance/charts/AffordabilityScatter.tsx',
      'ui/src/views/finance/charts/BudgetChart.tsx',
      'ui/src/views/finance/charts/CostBreakdownChart.tsx',
      'ui/src/views/finance/charts/DebtTrajectoryChart.tsx',
      'ui/src/views/finance/charts/InterestPrincipalChart.tsx',
      'ui/src/views/finance/charts/ListingPayoffChart.tsx',
      'ui/src/views/finance/components/AffordabilityPanel.tsx',
      'ui/src/views/finance/components/MilestoneTimeline.tsx',
      'ui/src/views/finance/components/ProfileForm.tsx',
      'ui/src/views/finance/components/PropertyForm.tsx',
      'ui/src/views/finance/components/RentPanel.tsx',
      'ui/src/views/finance/components/ResultSummary.tsx',
      'ui/src/views/finance/components/ScenarioForm.tsx',
      'ui/src/views/finance/components/VerdictBanner.tsx',
      'ui/src/components/listings/AffordabilityChip.tsx',
      'ui/src/components/listings/ExternalListingLink.tsx',
      'ui/src/components/listings/FilterSelect.tsx',
      'ui/src/components/listings/PriceChangeBadge.tsx',
      'ui/src/components/listings/StatusControl.tsx',
      'ui/src/components/map/Map.tsx',
      'ui/src/components/map/MapControls.tsx',
      'ui/src/components/map/MapDrawingExtension.ts',
      'ui/src/components/map/countryBounds.ts',
      'ui/src/components/map/maplibre.ts',
      'ui/src/components/map/overlayLayers.ts',
      'ui/src/components/map/popupContent.tsx',
      'ui/src/components/map/transitIcons.ts',
      'ui/src/components/transit/CommuteBadge.tsx',
      'ui/src/components/transit/DeparturesBoard.tsx',
      'ui/src/components/transit/NearbyStops.tsx',
      'ui/src/components/transit/TransitDetails.tsx',
      'ui/src/components/transit/TravelTimes.tsx',
      'ui/src/components/transit/transitFormat.ts',
      'ui/src/components/transit/travelTimeFormat.ts',
      'ui/src/views/listings/detailMapLayers.ts',
      'ui/src/views/listings/listingActions.ts',
      'ui/src/views/listings/listingPopupContent.tsx',
      'ui/src/views/listings/polyline.ts',
      'ui/src/services/routes/returnTo.ts',
      'ui/src/services/time/timeService.ts',
      'ui/src/services/notificationChannels/channelForm.ts',
      'ui/src/services/jobs/commuteFilter.ts',
      'ui/src/services/inquiries/profile.ts',
      'ui/src/hooks/useSearchParamState.ts',
      'ui/src/hooks/useScrollRestoration.ts',
      'ui/src/hooks/screenWidth.ts',
      'ui/src/services/countryFlags.ts',
      'ui/src/services/developmentMode.ts',
      'ui/src/services/authenticatedFetch.ts',
      'ui/src/services/notification/browserNotification.ts',
      'ui/src/components/connectivity/connectivityFormat.ts',
      'ui/src/services/transformer/providerTransformer.ts',
      'ui/src/services/debugLoggingClient.ts',
      'ui/src/services/backupRestoreClient.ts',
      'ui/src/Index.tsx',
      'ui/src/components/ListingDeletionModal.tsx',
      'ui/src/components/connectivity/ConnectivityCard.tsx',
      'ui/src/components/debug/DebugLoggingBanner.tsx',
      'ui/src/components/demo/DemoBanner.tsx',
      'ui/src/components/filters/ActiveFilterChips.tsx',
      'ui/src/components/filters/FilterButton.tsx',
      'ui/src/components/filters/FilterDrawer.tsx',
      'ui/src/components/footer/FredyFooter.tsx',
      'ui/src/components/grid/listings/ListingsGrid.tsx',
      'ui/src/components/headline/Headline.tsx',
      'ui/src/components/icons/IconEuro.tsx',
      'ui/src/components/listings/ListingsFilterPanel.tsx',
      'ui/src/components/listings/ListingsOverview.tsx',
      'ui/src/components/logo/Logo.tsx',
      'ui/src/components/logout/Logout.tsx',
      'ui/src/components/permission/InsufficientPermission.tsx',
      'ui/src/components/permission/PermissionAwareRoute.tsx',
      'ui/src/components/placeholder/Placeholder.tsx',
      'ui/src/components/segment/SegmentPart.tsx',
      'ui/src/components/settingsShell/SettingsShell.tsx',
      'ui/src/components/table/ListingsTable.tsx',
      'ui/src/components/table/NotificationChannelTable.tsx',
      'ui/src/services/i18n/i18n.tsx',
      'ui/src/services/notifications/browserAdapter.ts',
      'ui/src/services/sse/authenticatedEventStream.ts',
      'ui/src/services/state/store.ts',
      'ui/src/services/transitClient.ts',
      'ui/src/services/xhr.ts',
      'ui/src/utils.ts',
      'ui/src/views/admin/AdminLayout.tsx',
      'ui/src/views/admin/ScopeBanner.tsx',
      'ui/src/views/admin/pages/BackupPage.tsx',
      'ui/src/views/admin/pages/ConnectivityPage.tsx',
      'ui/src/views/admin/pages/DebugPage.tsx',
      'ui/src/views/admin/pages/ExecutionPage.tsx',
      'ui/src/views/admin/pages/SystemPage.tsx',
      'ui/src/views/admin/useAdminSettings.ts',
      'ui/src/views/dashboard/Dashboard.tsx',
      'ui/src/views/listings/Listings.tsx',
      'ui/src/views/listings/Map.tsx',
      'ui/src/views/listings/components/AddressEditor.tsx',
      'ui/src/views/listings/components/ListingFinanceCard.tsx',
      'ui/src/views/listings/components/PriceHistoryChart.tsx',
      'ui/src/views/login/Login.tsx',
      'ui/src/views/onboarding/ApplicantProfileOnboardingPage.tsx',
      'ui/src/views/settings/pages/InquiryProfilePage.tsx',
      'ui/src/views/settings/pages/NotificationsPage.tsx',
      'ui/src/views/settings/pages/TravelTimePage.tsx',
    ]);
    const testConfig = JSON.parse(read('tsconfig.frontend-tests.json'));
    expect(testConfig.extends).toBe('./tsconfig.frontend.json');
    expect(testConfig.compilerOptions.types).toEqual(['node']);
    expect(testConfig.include).toEqual([
      'ui/src/vite-env.d.ts',
      'test/ui/finalResponsiveSlice.test.ts',
      'test/ui/homeSurface.test.ts',
      'test/ui/applicantProfileOnboarding.test.ts',
      'test/ui/legacyRedirects.test.ts',
      'test/ui/navigationShell.test.tsx',
      'test/ui/noDonationSurface.test.ts',
      'test/ui/personalSettingsPages.test.ts',
      'test/ui/homeConvergence.test.ts',
      'test/ui/mapGrouping.test.ts',
      'test/ui/listingDetailSlice.test.ts',
      'test/ui/listingActions.test.ts',
      'test/ui/listingFilters.test.ts',
      'test/ui/guidedSearchForm.test.ts',
      'test/ui/providerUrl.test.ts',
      'test/ui/jobValidation.test.ts',
      'test/ui/dashboardAttention.test.ts',
      'test/ui/dealTypeCopyInSync.test.ts',
      'test/ui/jobDraft.test.ts',
      'test/ui/jobSummary.test.ts',
      'test/ui/jobFilters.test.ts',
      'test/ui/navModel.test.ts',
      'test/ui/theme.test.ts',
      'test/ui/firebaseAuth.test.ts',
      'test/ui/browserNotificationGate.d.ts',
      'test/ui/browserNotificationGate.test.ts',
      'test/ui/financeMathSingleHome.test.ts',
      'test/ui/financeState.test.ts',
      'test/ui/priceFormat.test.ts',
      'test/ui/useControllableState.test.ts',
      'test/ui/providerOrder.test.ts',
      'test/ui/providerCountries.test.ts',
      'test/ui/countryBounds.test.ts',
      'test/ui/mapOverlayLayers.test.ts',
      'test/ui/transitFormat.test.ts',
      'test/ui/travelTimeFormat.test.ts',
      'test/ui/detailMapLayers.test.ts',
      'test/ui/polyline.test.ts',
      'test/ui/returnTo.test.ts',
      'test/ui/timeZoneOptions.test.ts',
      'test/ui/channelForm.test.ts',
      'test/ui/commuteFilter.test.ts',
      'test/ui/inquiryProfile.test.ts',
      'test/ui/useUrlState.test.ts',
      'test/ui/notificationState.test.ts',
      'test/ui/userSettingsState.test.ts',
      'test/ui/jobsState.test.ts',
      'test/ui/listingsState.test.ts',
      'test/ui/authenticatedFetch.test.ts',
      'test/ui/authenticatedTransport.test.ts',
      'test/ui/apiUrl.test.ts',
      'test/ui/locales.test.ts',
      'test/ui/authenticatedEventStream.test.ts',
      'test/ui/globalShadowing.test.ts',
      'test/ui/homeViewState.test.ts',
      'test/ui/noWhatsNewSurface.test.ts',
    ]);
    const waveOneMigrations = [
      ['ui/src/components/cards/KpiCard.tsx', 'ui/src/components/cards/KpiCard.jsx'],
      ['ui/src/components/cards/ProviderShareChart.tsx', 'ui/src/components/cards/ProviderShareChart.jsx'],
      ['ui/src/components/cards/TrendSparkline.tsx', 'ui/src/components/cards/TrendSparkline.jsx'],
      ['ui/src/components/cards/chartTheme.ts', 'ui/src/components/cards/chartTheme.js'],
      ['ui/src/hooks/useFinanceProfile.ts', 'ui/src/hooks/useFinanceProfile.js'],
      ['ui/src/services/finance/constants.ts', 'ui/src/services/finance/constants.js'],
      ['ui/src/services/price/priceService.ts', 'ui/src/services/price/priceService.js'],
      ['ui/src/types/finance.ts', 'ui/src/types/finance.js'],
      ['ui/src/views/finance/FinanceCalculator.tsx', 'ui/src/views/finance/FinanceCalculator.jsx'],
      ['ui/src/views/finance/charts/AffordabilityScatter.tsx', 'ui/src/views/finance/charts/AffordabilityScatter.jsx'],
      ['ui/src/views/finance/charts/BudgetChart.tsx', 'ui/src/views/finance/charts/BudgetChart.jsx'],
      ['ui/src/views/finance/charts/CostBreakdownChart.tsx', 'ui/src/views/finance/charts/CostBreakdownChart.jsx'],
      ['ui/src/views/finance/charts/DebtTrajectoryChart.tsx', 'ui/src/views/finance/charts/DebtTrajectoryChart.jsx'],
      [
        'ui/src/views/finance/charts/InterestPrincipalChart.tsx',
        'ui/src/views/finance/charts/InterestPrincipalChart.jsx',
      ],
      ['ui/src/views/finance/charts/ListingPayoffChart.tsx', 'ui/src/views/finance/charts/ListingPayoffChart.jsx'],
      [
        'ui/src/views/finance/components/AffordabilityPanel.tsx',
        'ui/src/views/finance/components/AffordabilityPanel.jsx',
      ],
      [
        'ui/src/views/finance/components/MilestoneTimeline.tsx',
        'ui/src/views/finance/components/MilestoneTimeline.jsx',
      ],
      ['ui/src/views/finance/components/ProfileForm.tsx', 'ui/src/views/finance/components/ProfileForm.jsx'],
      ['ui/src/views/finance/components/PropertyForm.tsx', 'ui/src/views/finance/components/PropertyForm.jsx'],
      ['ui/src/views/finance/components/RentPanel.tsx', 'ui/src/views/finance/components/RentPanel.jsx'],
      ['ui/src/views/finance/components/ResultSummary.tsx', 'ui/src/views/finance/components/ResultSummary.jsx'],
      ['ui/src/views/finance/components/ScenarioForm.tsx', 'ui/src/views/finance/components/ScenarioForm.jsx'],
      ['ui/src/views/finance/components/VerdictBanner.tsx', 'ui/src/views/finance/components/VerdictBanner.jsx'],
      ['ui/src/hooks/useControllableState.ts', 'ui/src/hooks/useControllableState.js'],
      ['ui/src/services/providerOrder.ts', 'ui/src/services/providerOrder.js'],
      ['ui/src/hooks/useProviderCountries.ts', 'ui/src/hooks/useProviderCountries.js'],
      ['test/ui/financeMathSingleHome.test.ts', 'test/ui/financeMathSingleHome.test.js'],
      ['test/ui/financeState.test.ts', 'test/ui/financeState.test.js'],
      ['test/ui/priceFormat.test.ts', 'test/ui/priceFormat.test.js'],
      ['test/ui/useControllableState.test.ts', 'test/ui/useControllableState.test.js'],
      ['test/ui/providerOrder.test.ts', 'test/ui/providerOrder.test.js'],
      ['test/ui/providerCountries.test.ts', 'test/ui/providerCountries.test.js'],
    ];
    for (const [typedPath, legacyPath] of waveOneMigrations) {
      expect(fs.existsSync(path.join(root, typedPath)), typedPath).toBe(true);
      expect(fs.existsSync(path.join(root, legacyPath)), legacyPath).toBe(false);
    }
    const waveTwoMigrations = [
      ['ui/src/components/listings/AffordabilityChip.tsx', 'ui/src/components/listings/AffordabilityChip.jsx'],
      ['ui/src/components/listings/ExternalListingLink.tsx', 'ui/src/components/listings/ExternalListingLink.jsx'],
      ['ui/src/components/listings/FilterSelect.tsx', 'ui/src/components/listings/FilterSelect.jsx'],
      ['ui/src/components/listings/PriceChangeBadge.tsx', 'ui/src/components/listings/PriceChangeBadge.jsx'],
      ['ui/src/components/listings/StatusControl.tsx', 'ui/src/components/listings/StatusControl.jsx'],
      ['ui/src/components/map/Map.tsx', 'ui/src/components/map/Map.jsx'],
      ['ui/src/components/map/MapControls.tsx', 'ui/src/components/map/MapControls.jsx'],
      ['ui/src/components/map/MapDrawingExtension.ts', 'ui/src/components/map/MapDrawingExtension.js'],
      ['ui/src/components/map/countryBounds.ts', 'ui/src/components/map/countryBounds.js'],
      ['ui/src/components/map/maplibre.ts', 'ui/src/components/map/maplibre.js'],
      ['ui/src/components/map/overlayLayers.ts', 'ui/src/components/map/overlayLayers.js'],
      ['ui/src/components/map/popupContent.tsx', 'ui/src/components/map/popupContent.jsx'],
      ['ui/src/components/map/transitIcons.ts', 'ui/src/components/map/transitIcons.js'],
      ['ui/src/components/transit/CommuteBadge.tsx', 'ui/src/components/transit/CommuteBadge.jsx'],
      ['ui/src/components/transit/DeparturesBoard.tsx', 'ui/src/components/transit/DeparturesBoard.jsx'],
      ['ui/src/components/transit/NearbyStops.tsx', 'ui/src/components/transit/NearbyStops.jsx'],
      ['ui/src/components/transit/TransitDetails.tsx', 'ui/src/components/transit/TransitDetails.jsx'],
      ['ui/src/components/transit/TravelTimes.tsx', 'ui/src/components/transit/TravelTimes.jsx'],
      ['ui/src/components/transit/transitFormat.ts', 'ui/src/components/transit/transitFormat.js'],
      ['ui/src/components/transit/travelTimeFormat.ts', 'ui/src/components/transit/travelTimeFormat.js'],
      ['ui/src/views/listings/detailMapLayers.ts', 'ui/src/views/listings/detailMapLayers.js'],
      ['ui/src/views/listings/listingActions.ts', 'ui/src/views/listings/listingActions.js'],
      ['ui/src/views/listings/listingPopupContent.tsx', 'ui/src/views/listings/listingPopupContent.jsx'],
      ['ui/src/views/listings/polyline.ts', 'ui/src/views/listings/polyline.js'],
      ['test/ui/countryBounds.test.ts', 'test/ui/countryBounds.test.js'],
      ['test/ui/mapOverlayLayers.test.ts', 'test/ui/mapOverlayLayers.test.js'],
      ['test/ui/transitFormat.test.ts', 'test/ui/transitFormat.test.js'],
      ['test/ui/travelTimeFormat.test.ts', 'test/ui/travelTimeFormat.test.js'],
      ['test/ui/detailMapLayers.test.ts', 'test/ui/detailMapLayers.test.js'],
      ['test/ui/polyline.test.ts', 'test/ui/polyline.test.js'],
    ];
    for (const [typedPath, legacyPath] of waveTwoMigrations) {
      expect(fs.existsSync(path.join(root, typedPath)), typedPath).toBe(true);
      expect(fs.existsSync(path.join(root, legacyPath)), legacyPath).toBe(false);
    }
    const waveThreeMigrations = [
      ['ui/src/services/routes/returnTo.ts', 'ui/src/services/routes/returnTo.js'],
      ['ui/src/services/time/timeService.ts', 'ui/src/services/time/timeService.js'],
      ['ui/src/services/notificationChannels/channelForm.ts', 'ui/src/services/notificationChannels/channelForm.js'],
      ['ui/src/services/jobs/commuteFilter.ts', 'ui/src/services/jobs/commuteFilter.js'],
      ['ui/src/services/inquiries/profile.ts', 'ui/src/services/inquiries/profile.js'],
      ['ui/src/hooks/useSearchParamState.ts', 'ui/src/hooks/useSearchParamState.js'],
      ['ui/src/hooks/useScrollRestoration.ts', 'ui/src/hooks/useScrollRestoration.js'],
      ['ui/src/hooks/screenWidth.ts', 'ui/src/hooks/screenWidth.js'],
      ['ui/src/services/countryFlags.ts', 'ui/src/services/countryFlags.js'],
      ['ui/src/services/developmentMode.ts', 'ui/src/services/developmentMode.js'],
      ['ui/src/services/authenticatedFetch.ts', 'ui/src/services/authenticatedFetch.js'],
      ['ui/src/services/notification/browserNotification.ts', 'ui/src/services/notification/browserNotification.js'],
      ['ui/src/components/connectivity/connectivityFormat.ts', 'ui/src/components/connectivity/connectivityFormat.js'],
      ['ui/src/services/transformer/providerTransformer.ts', 'ui/src/services/transformer/providerTransformer.js'],
      ['ui/src/services/debugLoggingClient.ts', 'ui/src/services/debugLoggingClient.js'],
      ['ui/src/services/backupRestoreClient.ts', 'ui/src/services/backupRestoreClient.js'],
      ['test/ui/returnTo.test.ts', 'test/ui/returnTo.test.js'],
      ['test/ui/timeZoneOptions.test.ts', 'test/ui/timeZoneOptions.test.js'],
      ['test/ui/channelForm.test.ts', 'test/ui/channelForm.test.js'],
      ['test/ui/commuteFilter.test.ts', 'test/ui/commuteFilter.test.js'],
      ['test/ui/inquiryProfile.test.ts', 'test/ui/inquiryProfile.test.js'],
      ['test/ui/useUrlState.test.ts', 'test/ui/useUrlState.test.js'],
      ['test/ui/notificationState.test.ts', 'test/ui/notificationState.test.js'],
      ['test/ui/userSettingsState.test.ts', 'test/ui/userSettingsState.test.js'],
      ['test/ui/jobsState.test.ts', 'test/ui/jobsState.test.js'],
      ['test/ui/listingsState.test.ts', 'test/ui/listingsState.test.js'],
      ['test/ui/authenticatedFetch.test.ts', 'test/ui/authenticatedFetch.test.js'],
      ['test/ui/authenticatedTransport.test.ts', 'test/ui/authenticatedTransport.test.js'],
      ['test/ui/apiUrl.test.ts', 'test/ui/apiUrl.test.js'],
      ['test/ui/locales.test.ts', 'test/ui/locales.test.js'],
    ];
    expect(waveThreeMigrations).toHaveLength(30);
    for (const [typedPath, legacyPath] of waveThreeMigrations) {
      expect(fs.existsSync(path.join(root, typedPath)), typedPath).toBe(true);
      expect(fs.existsSync(path.join(root, legacyPath)), legacyPath).toBe(false);
    }
    const finalMigrations = [
      ['ui/src/Index.tsx', 'ui/src/Index.jsx'],
      ['ui/src/components/ListingDeletionModal.tsx', 'ui/src/components/ListingDeletionModal.jsx'],
      ['ui/src/components/connectivity/ConnectivityCard.tsx', 'ui/src/components/connectivity/ConnectivityCard.jsx'],
      ['ui/src/components/debug/DebugLoggingBanner.tsx', 'ui/src/components/debug/DebugLoggingBanner.jsx'],
      ['ui/src/components/demo/DemoBanner.tsx', 'ui/src/components/demo/DemoBanner.jsx'],
      ['ui/src/components/filters/ActiveFilterChips.tsx', 'ui/src/components/filters/ActiveFilterChips.jsx'],
      ['ui/src/components/filters/FilterButton.tsx', 'ui/src/components/filters/FilterButton.jsx'],
      ['ui/src/components/filters/FilterDrawer.tsx', 'ui/src/components/filters/FilterDrawer.jsx'],
      ['ui/src/components/footer/FredyFooter.tsx', 'ui/src/components/footer/FredyFooter.jsx'],
      ['ui/src/components/grid/listings/ListingsGrid.tsx', 'ui/src/components/grid/listings/ListingsGrid.jsx'],
      ['ui/src/components/headline/Headline.tsx', 'ui/src/components/headline/Headline.jsx'],
      ['ui/src/components/icons/IconEuro.tsx', 'ui/src/components/icons/IconEuro.jsx'],
      ['ui/src/components/listings/ListingsFilterPanel.tsx', 'ui/src/components/listings/ListingsFilterPanel.jsx'],
      ['ui/src/components/listings/ListingsOverview.tsx', 'ui/src/components/listings/ListingsOverview.jsx'],
      ['ui/src/components/logo/Logo.tsx', 'ui/src/components/logo/Logo.jsx'],
      ['ui/src/components/logout/Logout.tsx', 'ui/src/components/logout/Logout.jsx'],
      [
        'ui/src/components/permission/InsufficientPermission.tsx',
        'ui/src/components/permission/InsufficientPermission.jsx',
      ],
      [
        'ui/src/components/permission/PermissionAwareRoute.tsx',
        'ui/src/components/permission/PermissionAwareRoute.jsx',
      ],
      ['ui/src/components/placeholder/Placeholder.tsx', 'ui/src/components/placeholder/Placeholder.jsx'],
      ['ui/src/components/segment/SegmentPart.tsx', 'ui/src/components/segment/SegmentPart.jsx'],
      ['ui/src/components/settingsShell/SettingsShell.tsx', 'ui/src/components/settingsShell/SettingsShell.jsx'],
      ['ui/src/components/table/ListingsTable.tsx', 'ui/src/components/table/ListingsTable.jsx'],
      ['ui/src/components/table/NotificationChannelTable.tsx', 'ui/src/components/table/NotificationChannelTable.jsx'],
      ['ui/src/services/i18n/i18n.tsx', 'ui/src/services/i18n/i18n.jsx'],
      ['ui/src/services/notifications/browserAdapter.ts', 'ui/src/services/notifications/browserAdapter.js'],
      ['ui/src/services/sse/authenticatedEventStream.ts', 'ui/src/services/sse/authenticatedEventStream.js'],
      ['ui/src/services/state/store.ts', 'ui/src/services/state/store.js'],
      ['ui/src/services/transitClient.ts', 'ui/src/services/transitClient.js'],
      ['ui/src/services/xhr.ts', 'ui/src/services/xhr.js'],
      ['ui/src/utils.ts', 'ui/src/utils.js'],
      ['ui/src/views/admin/AdminLayout.tsx', 'ui/src/views/admin/AdminLayout.jsx'],
      ['ui/src/views/admin/ScopeBanner.tsx', 'ui/src/views/admin/ScopeBanner.jsx'],
      ['ui/src/views/admin/pages/BackupPage.tsx', 'ui/src/views/admin/pages/BackupPage.jsx'],
      ['ui/src/views/admin/pages/ConnectivityPage.tsx', 'ui/src/views/admin/pages/ConnectivityPage.jsx'],
      ['ui/src/views/admin/pages/DebugPage.tsx', 'ui/src/views/admin/pages/DebugPage.jsx'],
      ['ui/src/views/admin/pages/ExecutionPage.tsx', 'ui/src/views/admin/pages/ExecutionPage.jsx'],
      ['ui/src/views/admin/pages/SystemPage.tsx', 'ui/src/views/admin/pages/SystemPage.jsx'],
      ['ui/src/views/admin/useAdminSettings.ts', 'ui/src/views/admin/useAdminSettings.js'],
      ['ui/src/views/dashboard/Dashboard.tsx', 'ui/src/views/dashboard/Dashboard.jsx'],
      [
        'ui/src/views/jobs/mutation/components/CommuteFilter.tsx',
        'ui/src/views/jobs/mutation/components/CommuteFilter.jsx',
      ],
      [
        'ui/src/views/jobs/mutation/components/areaFilter/AreaFilter.tsx',
        'ui/src/views/jobs/mutation/components/areaFilter/AreaFilter.jsx',
      ],
      [
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationChannelEditor.tsx',
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationChannelEditor.jsx',
      ],
      [
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationChannelPicker.tsx',
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationChannelPicker.jsx',
      ],
      [
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationHelpDisplay.tsx',
        'ui/src/views/jobs/mutation/components/notificationAdapter/NotificationHelpDisplay.jsx',
      ],
      [
        'ui/src/views/jobs/mutation/components/provider/ProviderMutator.tsx',
        'ui/src/views/jobs/mutation/components/provider/ProviderMutator.jsx',
      ],
      ['ui/src/views/listings/Listings.tsx', 'ui/src/views/listings/Listings.jsx'],
      ['ui/src/views/listings/Map.tsx', 'ui/src/views/listings/Map.jsx'],
      ['ui/src/views/listings/components/AddressEditor.tsx', 'ui/src/views/listings/components/AddressEditor.jsx'],
      [
        'ui/src/views/listings/components/ListingFinanceCard.tsx',
        'ui/src/views/listings/components/ListingFinanceCard.jsx',
      ],
      [
        'ui/src/views/listings/components/PriceHistoryChart.tsx',
        'ui/src/views/listings/components/PriceHistoryChart.jsx',
      ],
      ['ui/src/views/login/Login.tsx', 'ui/src/views/login/Login.jsx'],
      [
        'ui/src/views/onboarding/ApplicantProfileOnboardingPage.tsx',
        'ui/src/views/onboarding/ApplicantProfileOnboardingPage.jsx',
      ],
      ['ui/src/views/settings/pages/InquiryProfilePage.tsx', 'ui/src/views/settings/pages/InquiryProfilePage.jsx'],
      ['ui/src/views/settings/pages/NotificationsPage.tsx', 'ui/src/views/settings/pages/NotificationsPage.jsx'],
      ['ui/src/views/settings/pages/TravelTimePage.tsx', 'ui/src/views/settings/pages/TravelTimePage.jsx'],
      ['test/ui/authenticatedEventStream.test.ts', 'test/ui/authenticatedEventStream.test.js'],
      ['test/ui/globalShadowing.test.ts', 'test/ui/globalShadowing.test.js'],
      ['test/ui/homeViewState.test.ts', 'test/ui/homeViewState.test.js'],
      ['test/ui/noWhatsNewSurface.test.ts', 'test/ui/noWhatsNewSurface.test.js'],
    ];
    expect(finalMigrations).toHaveLength(59);
    for (const [typedPath, legacyPath] of finalMigrations) {
      expect(fs.existsSync(path.join(root, typedPath)), typedPath).toBe(true);
      expect(fs.existsSync(path.join(root, legacyPath)), legacyPath).toBe(false);
    }
    expect(filesBelow(path.join(root, 'ui/src')).filter((file) => /\.(?:js|jsx)$/.test(file))).toEqual([]);
    expect(filesBelow(path.join(root, 'test/ui')).filter((file) => /\.test\.js$/.test(file))).toEqual([]);
    // The ambient shims those real modules replaced are gone, so nothing can resolve the stale
    // untyped shape ahead of the typed source.
    const legacyShims = read('ui/src/views/jobs/savedSearchesLegacy.d.ts');
    expect(legacyShims).not.toContain("declare module '*services/time/timeService.js'");
    expect(legacyShims).not.toContain("declare module '*services/inquiries/profile.js'");
    expect(fs.existsSync(path.join(root, 'ui/src/services/apiUrl.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/apiUrl.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/guidedSearchForm.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/guidedSearchForm.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/providerUrl.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/providerUrl.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobValidation.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobValidation.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobValidation.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/dashboard/attention.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/dealType.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobDraft.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobSummary.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/jobs/jobFilters.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/home/homeViewState.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/home/homeViewState.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/listings/mapUtils.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/listings/mapUtils.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/home/Home.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/App.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/App.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/components/navigation/Navigation.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/components/navigation/Navigation.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/SettingsLayout.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/SettingsLayout.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/navigationShell.test.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/navigationShell.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/PreferencesPage.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/PreferencesPage.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/ListingDetailsPage.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/settings/pages/ListingDetailsPage.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/personalSettingsPages.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/listings/ListingDetail.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/views/listings/ListingDetail.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/listings/listingFilters.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/listings/listingFilters.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/listingFilters.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/listingFilters.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/mapGrouping.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/mapGrouping.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/guidedSearchForm.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/guidedSearchForm.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/jobValidation.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/jobValidation.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/finalResponsiveSlice.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/finalResponsiveSlice.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/listingDetailSlice.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/listingDetailSlice.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/listingActions.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/listingActions.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/providerUrl.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'test/ui/providerUrl.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/dashboardAttention.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/dealTypeCopyInSync.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/jobDraft.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/jobSummary.test.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/jobFilters.test.js'))).toBe(false);
    const migratedSources = [
      [
        'ui/src/components/navigation/navModel.ts',
        ['ui/src/components/navigation/navModel.js', 'ui/src/components/navigation/navModel.d.ts'],
      ],
      [
        'ui/src/services/onboarding/applicantProfileOnboarding.ts',
        [
          'ui/src/services/onboarding/applicantProfileOnboarding.js',
          'ui/src/services/onboarding/applicantProfileOnboarding.d.ts',
        ],
      ],
      [
        'ui/src/services/routes/legacyRedirects.ts',
        ['ui/src/services/routes/legacyRedirects.js', 'ui/src/services/routes/legacyRedirects.d.ts'],
      ],
      ['ui/src/services/theme/theme.ts', ['ui/src/services/theme/theme.js', 'ui/src/services/theme/theme.d.ts']],
      [
        'ui/src/services/auth/firebaseAuth.ts',
        ['ui/src/services/auth/firebaseAuth.js', 'ui/src/services/auth/firebaseAuth.d.ts'],
      ],
      [
        'ui/src/hooks/useBrowserNotifications.ts',
        ['ui/src/hooks/useBrowserNotifications.js', 'ui/src/hooks/useBrowserNotifications.d.ts'],
      ],
    ];
    for (const [typescriptPath, obsoletePaths] of migratedSources) {
      expect(fs.existsSync(path.join(root, typescriptPath)), typescriptPath).toBe(true);
      for (const obsoletePath of obsoletePaths) {
        expect(fs.existsSync(path.join(root, obsoletePath)), obsoletePath).toBe(false);
      }
    }
    for (const testPath of ['navModel', 'theme', 'firebaseAuth', 'browserNotificationGate']) {
      expect(fs.existsSync(path.join(root, `test/ui/${testPath}.test.ts`)), testPath).toBe(true);
      expect(fs.existsSync(path.join(root, `test/ui/${testPath}.test.js`)), testPath).toBe(false);
    }
    expect(fs.existsSync(path.join(root, 'ui/src/services/notifications/browserAdapter.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/notifications/browserAdapter.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/services/notifications/browserAdapter.d.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'test/ui/browserNotificationGate.d.ts'))).toBe(true);
    expect(read('ui/src/views/jobs/savedSearchesLegacy.d.ts')).not.toContain("declare module '*mapUtils.js'");
  });

  it('requires both lockfiles and the executable lock policy guard', () => {
    expect(fs.existsSync(path.join(root, 'bun.lock'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'yarn.lock'))).toBe(true);
    expect(read('bunfig.toml')).toContain('lockfile = true');
    expect(() => execFileSync(process.execPath, ['scripts/check-lockfiles.js'], { cwd: root })).not.toThrow();
  });

  it('uses Bun for frontend CI and Yarn/Node for backend CI', () => {
    const pullRequest = read('.github/workflows/pr.yml');
    const deploy = read('.github/workflows/deploy.yml');
    const frontend = workflowJob(pullRequest, 'frontend', 'backend-tests');
    const backend = workflowJob(pullRequest, 'backend-tests', 'backend-image');
    const pages = workflowJob(deploy, 'pages-build', 'pages-deploy');

    expect(frontend).toContain('oven-sh/setup-bun@v2');
    expect(frontend).toContain('bun-version-file: .bun-version');
    expect(frontend).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(frontend).toContain('bun run typecheck:frontend');
    expect(frontend).toContain('bun run test:frontend');
    expect(frontend).toContain('bun run build:frontend');
    expect(backend).toContain('actions/setup-node@v5');
    expect(backend).toContain('yarn install --frozen-lockfile --ignore-scripts');
    expect(backend).toContain('npx vitest run --exclude');
    expect(pages).toContain('oven-sh/setup-bun@v2');
    expect(pages).toContain('bun-version-file: .bun-version');
    expect(pages).toContain('bun install --frozen-lockfile --ignore-scripts');
    expect(pages).toContain('bun run build:frontend');
  });

  it('pins the dormant Rust executable and validates it only in conditional PR CI', () => {
    const manifest = read('rust/health-route/Cargo.toml');
    const toolchain = read('rust/health-route/rust-toolchain.toml');
    const rustWorkflow = workflowJob(read('.github/workflows/pr.yml'), 'rust-tests', 'gate');
    const deploy = read('.github/workflows/deploy.yml');

    expect(manifest).toContain('name = "fredy-health-route"');
    expect(manifest).toContain('[dependencies]');
    expect(manifest).toContain('serde_json = { version = "=1.0.140", features = ["preserve_order"] }');
    expect(toolchain).toContain('channel = "1.85.1"');
    expect(toolchain).toContain('components = ["rustfmt", "clippy"]');
    expect(rustWorkflow).toContain("if: needs.changes.outputs.rust == 'true'");
    expect(rustWorkflow).toContain('cargo test --locked');
    expect(rustWorkflow).toContain('cargo fmt --check');
    expect(rustWorkflow).toContain('cargo check --locked');
    expect(deploy).not.toContain("- 'rust/**'");
  });
});
