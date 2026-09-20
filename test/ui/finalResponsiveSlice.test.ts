/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSavedSearchDirectAction, shouldShowPause } from '../../ui/src/views/jobs/savedSearchActions';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf8');

const jobMutationStyles = read('ui/src/views/jobs/mutation/JobMutation.less');
const navigationStyles = read('ui/src/components/navigation/Navigate.less');
const onboardingStyles = read('ui/src/views/onboarding/ApplicantProfileOnboardingPage.less');
const savedSearchesSource = read('ui/src/views/jobs/SavedSearchesIndex.tsx');
const savedSearchActionsSource = read('ui/src/views/jobs/savedSearchActions.ts');
const savedSearchesStyles = read('ui/src/views/jobs/SavedSearchesIndex.less');
const jobsSource = read('ui/src/views/jobs/Jobs.tsx');

describe('final responsive slice', () => {
  it('does not leak a fixed select popup width from the job mutation stylesheet', () => {
    expect(jobMutationStyles).not.toMatch(/semi-select-option-list-wrapper/);
    expect(jobMutationStyles).not.toMatch(/width:\s*25rem/);
  });

  it('hides the footer only after a rendered mobile primary navigation', () => {
    const mobileRule = navigationStyles.indexOf('.fredy-shell-nav__mobile-primary + .app__main .fredyFooter');
    const mobileMedia = navigationStyles.indexOf('@media (max-width: 768px)');

    expect(mobileRule).toBeGreaterThan(mobileMedia);
    expect(navigationStyles).toMatch(
      /\.fredy-shell-nav__mobile-primary \+ \.app__main \.fredyFooter\s*{\s*display:\s*none;/,
    );
    expect(navigationStyles).not.toMatch(/\.fredy-shell-nav\s+\.fredyFooter/);
  });

  it('keeps the onboarding grid responsive while making every input wrapper 44px', () => {
    expect(onboardingStyles).toMatch(/\.semi-input-wrapper\s*{\s*min-height:\s*44px;/);
    expect(onboardingStyles).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(onboardingStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it('renders the approved Saved Searches fields as one semantic row/card surface', () => {
    expect(jobsSource).toContain("import SavedSearchesIndex from './SavedSearchesIndex';");
    expect(jobsSource).toContain('className="jobs__heading"');
    expect(jobsSource).toContain("t('jobs.index.eyebrow')");
    expect(jobsSource).toContain("t('jobs.index.heading')");
    expect(jobsSource).toContain("t('jobs.index.description')");
    expect(savedSearchesSource).toContain('className="savedSearches__createCard"');
    expect(savedSearchesSource).toContain("t('jobs.index.addAnother')");
    expect(savedSearchesSource).toContain("t('jobs.index.addAnotherHelp')");
    expect(savedSearchesSource).toContain('className="savedSearches__identity"');
    expect(savedSearchesSource).toContain('className="savedSearches__state"');
    expect(savedSearchesSource).toContain('className="savedSearches__lastRun"');
    expect(savedSearchesSource).toContain('className="savedSearches__rowActions"');
    expect(savedSearchesSource).toContain("t('jobs.index.criteria')");
    expect(savedSearchesSource).toContain("t('jobs.index.lastRun')");
    expect(savedSearchesSource).toContain("t('jobs.index.neverRun')");
  });

  it('keeps the row actions and read-only state accessible', () => {
    expect(savedSearchesSource).toContain('role="menu"');
    expect(savedSearchesSource).toContain('role="menuitem"');
    expect(savedSearchesSource).toContain("aria-label={t('jobs.index.overflowFor'");
    expect(savedSearchesSource).toContain("aria-label={t('jobs.index.directActionFor'");
    expect(savedSearchesSource).toContain('<Tag color={job.enabled');
    expect(savedSearchesSource).not.toContain('<Switch');
    expect(savedSearchesSource).toContain('disabled={readOnly}');
    expect(savedSearchesSource).toContain('disabled={directAction.disabled}');
  });

  it('preserves SSE, run, pause, delete, filters, and pagination behavior in the deep feature module', () => {
    for (const marker of [
      'createAuthenticatedEventStream',
      'xhrPost(`/api/jobs/${jobId}/run`, {})',
      'xhrPut(`/api/jobs/${jobId}/status`',
      "xhrDelete('/api/jobs'",
      'FilterDrawer',
      'Pagination',
      'setJobRunning',
      'pendingJobIdRef',
    ]) {
      expect(savedSearchesSource).toContain(marker);
    }
  });

  it('keeps the migrated Saved Searches source explicit at legacy boundaries', () => {
    expect(savedSearchesSource).not.toContain('@ts-expect-error');
    expect(jobsSource).not.toContain('@ts-expect-error');
    expect(savedSearchesSource).not.toMatch(/\bas any\b/);
    expect(jobsSource).not.toMatch(/\bas any\b/);
  });
  it('opens editable Saved Search rows directly and keeps one Create action', () => {
    expect(savedSearchesSource).toContain("role: 'button' as const");
    expect(savedSearchesSource).toContain('tabIndex: 0');
    expect(savedSearchesSource).toContain("event.key === 'Enter' || event.key === ' '");
    expect(savedSearchesSource).toContain("event.target.closest('.savedSearches__rowActions')");
    expect(savedSearchesSource).toContain("t('jobs.index.runAndRepair')");
    expect(savedSearchesSource).toContain('onRepair={onJobRun}');
    expect(savedSearchesSource).not.toContain("action(t('jobs.index.edit')");
    expect(savedSearchesSource).not.toContain('/repair`');
    expect(savedSearchesSource).not.toContain('eslint-disable');
    expect(jobsSource).not.toContain("navigate('/jobs/new')");
    expect(savedSearchesSource.match(/navigate\('\/jobs\/new'\)/g)).toHaveLength(1);
  });

  it('uses direct state actions and a separate overflow trigger', () => {
    expect(savedSearchesSource).toContain('className="savedSearches__directAction"');
    expect(savedSearchesSource).toContain('className="savedSearches__overflowButton"');
    expect(savedSearchesSource).toContain('IconMoreStroked');
    expect(savedSearchesSource).toContain("t('jobs.index.pause')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.resume')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.running')");
    expect(savedSearchActionsSource).toContain("t('jobs.index.readOnlyAction')");
    expect(savedSearchesSource).not.toContain("t('jobs.index.actions')");
    expect(fs.existsSync(path.join(root, 'ui/src/components/grid/jobs/JobGrid.jsx'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ui/src/components/table/JobsTable.jsx'))).toBe(false);
  });

  it('models direct actions and active-only pause behavior', () => {
    const t = (key: string) => key;
    expect(getSavedSearchDirectAction({ enabled: true, running: false, isOnlyShared: false }, t)).toEqual({
      kind: 'run',
      label: 'jobs.index.run',
      disabled: false,
    });

    expect(getSavedSearchDirectAction({ enabled: false, running: false, isOnlyShared: false }, t)).toEqual({
      kind: 'resume',
      label: 'jobs.index.resume',
      disabled: false,
    });
    expect(getSavedSearchDirectAction({ enabled: true, running: true, isOnlyShared: false }, t)).toEqual({
      kind: 'running',
      label: 'jobs.index.running',
      disabled: true,
    });
    expect(getSavedSearchDirectAction({ enabled: true, running: false, isOnlyShared: true }, t)).toEqual({
      kind: 'readOnly',
      label: 'jobs.index.readOnlyAction',
      disabled: true,
    });
    expect(shouldShowPause({ enabled: true, isOnlyShared: false })).toBe(true);
    expect(shouldShowPause({ enabled: false, isOnlyShared: false })).toBe(false);
    expect(shouldShowPause({ enabled: true, isOnlyShared: true })).toBe(false);
  });

  it('defines each direct-action locale key once and removes obsolete generic controls', () => {
    for (const locale of ['en', 'de', 'tr']) {
      const source = read(`ui/src/locales/${locale}.json`);
      expect(source.match(/"jobs\.index\.run":/g)).toHaveLength(1);
      expect(source).not.toContain('"jobs.index.actions":');
      expect(source).not.toContain('"jobs.index.actionsFor":');
      expect(source).not.toContain('"jobs.index.toggle":');
    }
  });

  it('keeps mobile action targets at least 44px', () => {
    expect(savedSearchesStyles).toMatch(/&__sortDirection\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__stateControl\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__directAction\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__overflowButton\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__menuAction\s*{[\s\S]*min-height:\s*44px;/);
    expect(savedSearchesStyles).toMatch(/&__createCard\s*{/);
    expect(savedSearchesStyles).toMatch(
      /@media \(max-width: 640px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/,
    );
  });
});
