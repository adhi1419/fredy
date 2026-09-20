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
      'ui/src/AppLegacyComponents.d.ts',
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
      'ui/src/services/state/store.d.ts',
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
      'ui/src/services/notifications/browserAdapter.d.ts',
      'ui/src/hooks/useBrowserNotifications.ts',
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
    ]);
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
    expect(fs.existsSync(path.join(root, 'ui/src/services/notifications/browserAdapter.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ui/src/services/notifications/browserAdapter.d.ts'))).toBe(true);
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
